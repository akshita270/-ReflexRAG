from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import re
import json
import uuid
import numpy as np
import faiss
import os
import psycopg2
import psycopg2.extras
import redis
import boto3
from celery.result import AsyncResult
from celery_app import celery_app
import tasks as celery_tasks
from io import BytesIO

load_dotenv()
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer, CrossEncoder
from rank_bm25 import BM25Okapi
from sklearn.metrics.pairwise import cosine_similarity
from openai import OpenAI

embed_model = None
reranker = None
client = None
cache: redis.Redis | None = None
s3 = None
sessions: dict = {}


def get_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        sslmode="require",
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global embed_model, reranker, client, cache
    embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
    try:
        cache = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
        cache.ping()
        print("Redis connected")
    except Exception as e:
        print(f"Redis unavailable, caching disabled: {e}")
        cache = None
    try:
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.head_bucket(Bucket=os.getenv("S3_BUCKET", "reflexrag-pdfs"))
        print("S3 connected")
    except Exception as e:
        print(f"S3 unavailable: {e}")
        s3 = None
    yield


app = FastAPI(title="Clinical RAG API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = (
    "You are a clinical research assistant. "
    "Answer questions using ONLY the provided context chunks. "
    "You may synthesize and compare information across multiple chunks — "
    "you do not need a single chunk that directly states the comparison. "
    "If the context contains relevant facts about each entity separately, "
    "use them to construct a complete comparative answer. "
    "Only respond with 'NOT FOUND:' if the context contains NO relevant "
    "information at all about the topic."
)

REFLECTION_SYSTEM = (
    "You are a strict evaluator for a clinical RAG system. "
    "Be concise and respond only with valid JSON."
)


# ── TEXT PROCESSING ──────────────────────────────────────────

_ROW_CONTINUATION_STARTERS = frozenset({
    "second", "third", "first", "also", "often", "best", "look", "turn",
    "click", "possible", "radiation", "radiates", "increase", "increases",
    "decrease", "heard", "noted", "usually", "rarely", "may", "associated",
    "absent", "component", "split", "delayed", "quiet", "opening", "occurs",
    "maximal", "maximum", "small", "large", "loud", "soft", "blowing",
    "pansystolic", "machinery", "fixed", "murmurs", "murmur", "rics", "lics",
    "occasionally", "apex", "neck", "axilla", "carotid", "sternal", "base",
    "beats", "excessively", "occupations", "and", "symptoms", "suggest",
})

# Specific two-word condition patterns: split only when followed by the right second word.
# This avoids false splits like "Pulmonarycomponent" → wrong new row.
_CONCAT_SPLIT_RE = re.compile(
    r"([a-z,;'])("
    r"Aortic\s+(?:stenosis|regurgitation)|"
    r"Mitral\s+(?:stenosis|incompetence|prolapse)|"
    r"Pulmonary\s+(?:stenosis|incompetence|hypertension)|"
    r"Tricuspid\s+(?:incompetence|stenosis)|"
    r"Ventricular\s+septal|"
    r"Atrial\s+septal|"
    r"Patent\s+ductus|"
    r"Coarctation\s+of|"
    r"Slow-rising|Collapsing|Alternans|Bisferiens|Paradoxus|"
    r"Pleural\s+effusion|Consolidation|Pneumothorax"
    r")",
)


def restructure_tables(raw_text: str) -> str:
    """
    Finds clinical tables by column-header patterns (Lesion/Type/Character…)
    and splits each table body into one TABLE_ROW chunk per condition.
    Rule-based, no LLM — terms are always copied verbatim from the source.

    Handles two PDF quirks:
    - Row wrapping: 'Aortic stenosis Harsh ejection systolic, maximal in\\nsecond RICS'
    - Row concatenation: 'pulsatile liverPulmonary stenosis Midsystolic'
    """
    table_re = re.compile(
        r"([A-Z][^\n]{5,80}\n)"
        r"((?:Lesion|Type|Character|Feature|Sign|Condition|Finding)\s[^\n]+\n)"
        r"((?:[^\n]{15,}\n){3,30})",
        re.IGNORECASE,
    )

    replacements = []
    for match in table_re.finditer(raw_text):
        body = match.group(3)

        # Pre-split rows concatenated without space: 'liverPulmonary stenosis' → 'liver\nPulmonary stenosis'
        body = _CONCAT_SPLIT_RE.sub(r"\1\n\2", body)

        lines = [l.strip() for l in body.split("\n") if l.strip()]
        rows: list[str] = []
        current: str = ""

        for line in lines:
            first = line.split()[0].lower() if line.split() else ""
            is_new_row = (
                line[0].isupper()
                and first not in _ROW_CONTINUATION_STARTERS
                and len(first) > 2
            )
            if is_new_row:
                if current:
                    rows.append(current.strip())
                current = line
            else:
                current += " " + line

        if current:
            rows.append(current.strip())

        if rows:
            # End each row with "." so sentence-splitting in chunk_text can
            # separate them even after clean_text collapses newlines to spaces.
            def _end(r: str) -> str:
                return r if r.endswith((".", "!", "?")) else r + "."
            tagged = "\n".join(f"TABLE_ROW: {_end(r)}" for r in rows)
            replacements.append((match.start(), match.end(), f". {tagged}\n"))

    # Apply in reverse so earlier replacements don't shift later positions
    result = raw_text
    for start, end, replacement in reversed(replacements):
        result = result[:start] + replacement + result[end:]

    return result


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\n+", "\n", text)
    text = re.sub(r"(\w+)-\s+(\w+)", r"\1\2", text)
    return text.strip()


def is_valid_chunk(chunk: str, min_words: int = 15) -> bool:
    # Table rows are short but valid — bypass word-count filter for them
    if chunk.startswith("TABLE_ROW:"):
        return True
    words = chunk.split()
    if len(words) < min_words:
        return False
    if chunk.count("...") > 3:
        return False
    if chunk.count("....") > 2:
        return False
    roman = re.findall(r"\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b", chunk.lower())
    if len(roman) > 5:
        return False
    return True


def chunk_text(text: str, chunk_size: int = 600, overlap: int = 100) -> list:
    sentences = re.split(r"(?<=[.?!])\s+", text)
    chunks = []
    current_chunk = ""
    for sentence in sentences:
        # TABLE_ROW sentences must never be merged — flush and emit individually
        if sentence.strip().startswith("TABLE_ROW:"):
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
                current_chunk = ""
            chunks.append(sentence.strip())
            continue
        if len(current_chunk) + len(sentence) <= chunk_size:
            current_chunk += " " + sentence
        else:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
            overlap_text = current_chunk[-overlap:] if len(current_chunk) > overlap else current_chunk
            current_chunk = overlap_text + " " + sentence
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    return [c for c in chunks if is_valid_chunk(c)]


# ── RETRIEVAL ────────────────────────────────────────────────

def reciprocal_rank_fusion(ranked_lists: list, k: int = 60) -> list:
    scores = {}
    for ranked in ranked_lists:
        for rank, idx in enumerate(ranked):
            scores[idx] = scores.get(idx, 0) + 1 / (k + rank + 1)
    return sorted(scores, key=scores.get, reverse=True)


def hybrid_search(query: str, chunks: list, index, bm25, k: int = 12) -> list:
    query_embedding = embed_model.encode([query], convert_to_numpy=True)
    _, faiss_indices = index.search(np.array(query_embedding, dtype=np.float32), k)
    faiss_ranked = list(faiss_indices[0])
    bm25_scores = bm25.get_scores(query.lower().split())
    bm25_ranked = list(np.argsort(bm25_scores)[::-1][:k])
    combined = reciprocal_rank_fusion([faiss_ranked, bm25_ranked])[:k]
    return [chunks[i] for i in combined]


def boost_exact_matches(query: str, chunks: list) -> list:
    """Move chunks containing exact multi-word query terms to the front."""
    # Extract phrases of 2+ words and individual long words from query
    words = [w.lower() for w in re.findall(r"\b\w{4,}\b", query)]
    high, normal = [], []
    for chunk in chunks:
        lower = chunk.lower()
        if any(w in lower for w in words):
            high.append(chunk)
        else:
            normal.append(chunk)
    return high + normal


def mmr(query: str, retrieved_chunks: list, lambda_param: float = 0.7, top_k: int = 6) -> list:
    if not retrieved_chunks:
        return []
    query_emb = embed_model.encode([query])
    chunk_embs = embed_model.encode(retrieved_chunks)
    selected = []
    candidate_indices = list(range(len(retrieved_chunks)))
    while len(selected) < top_k and candidate_indices:
        scores = []
        for i in candidate_indices:
            emb = chunk_embs[i].reshape(1, -1)
            relevance = cosine_similarity(query_emb, emb)[0][0]
            if selected:
                diversity = max(cosine_similarity(emb, chunk_embs[selected].reshape(len(selected), -1))[0])
            else:
                diversity = 0.0
            scores.append((i, lambda_param * relevance - (1 - lambda_param) * diversity))
        best_idx = max(scores, key=lambda x: x[1])[0]
        selected.append(best_idx)
        candidate_indices.remove(best_idx)
    return [retrieved_chunks[i] for i in selected]


def rerank(query: str, chunks: list) -> list:
    if not chunks:
        return []
    scores = reranker.predict([[query, chunk] for chunk in chunks])
    return [c for c, _ in sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)]


COMPARISON_PATTERNS = re.compile(
    r"\b(differ|difference|compare|comparison|vs|versus|distinguish|contrast)\b", re.I
)

def is_comparison_query(query: str) -> bool:
    return bool(COMPARISON_PATTERNS.search(query))


def decompose_comparison(query: str) -> list:
    """For comparison queries, extract one sub-query per entity so both get retrieved."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": (
            f"This is a comparison question: '{query}'\n"
            f"Write 2 separate search queries — one for each condition/entity being compared.\n"
            f"Return exactly 2 lines, one query per line, no numbering or bullets."
        )}],
        temperature=0.0,
        max_tokens=80,
    )
    lines = [l.strip() for l in response.choices[0].message.content.strip().split("\n") if l.strip()]
    return lines[:2]


def expand_query(query: str) -> list:
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": (
            f"Generate 3 alternative phrasings of this question "
            f"for searching a neuroscience research paper. "
            f"Return only the questions, one per line, no numbering.\n\nQuestion: {query}"
        )}],
        temperature=0.5,
        max_tokens=200,
    )
    return response.choices[0].message.content.strip().split("\n")


# ── SELF-REFLECTION ──────────────────────────────────────────

def grade_retrieval(query: str, chunks: list) -> list:
    if not chunks:
        return []
    chunk_list = "\n\n".join([f"[{i+1}] {c[:300]}" for i, c in enumerate(chunks)])
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": REFLECTION_SYSTEM},
                {"role": "user", "content": (
                    f"Query: {query}\n\nRate each chunk as relevant (Y) or not (N).\n"
                    f"Chunks:\n{chunk_list}\n\n"
                    f"Respond ONLY with JSON: {{\"grades\": [\"Y\", \"N\", ...]}} — one grade per chunk."
                )},
            ],
            temperature=0.0,
            max_tokens=80,
        )
        text = response.choices[0].message.content.strip()
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            grades = json.loads(match.group()).get("grades", [])
            relevant = [c for c, g in zip(chunks, grades) if str(g).upper() == "Y"]
            return relevant if relevant else chunks
    except Exception:
        pass
    return chunks


def grade_answer(query: str, answer: str, context: str) -> dict:
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": REFLECTION_SYSTEM},
                {"role": "user", "content": (
                    f"Context:\n{context[:1500]}\n\n"
                    f"Question: {query}\n\nAnswer: {answer}\n\n"
                    f"Grade this answer with STRICT medical fact-checking.\n"
                    f"Be especially strict about these opposites — any inversion = UNFAITHFUL:\n"
                    f"  - Left vs Right (LICS vs RICS)\n"
                    f"  - Systolic vs Diastolic\n"
                    f"  - Inspiration vs Expiration\n"
                    f"  - Specific anatomical positions (apex, base, sternal border)\n"
                    f"  - Increases vs Decreases\n\n"
                    f"To grade faithful=true, every specific fact in the answer must be "
                    f"EXPLICITLY present in the context — not just semantically similar.\n\n"
                    f"Respond with JSON: {{\"faithful\": true/false, \"relevant\": true/false, \"reason\": \"one sentence\"}}"
                )},
            ],
            temperature=0.0,
            max_tokens=150,
        )
        text = response.choices[0].message.content.strip()
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except Exception:
        pass
    return {"faithful": True, "relevant": True, "reason": "grading unavailable"}


# ── PIPELINE ─────────────────────────────────────────────────

def run_pipeline(query: str, chunks: list, index, bm25, chat_history: list, max_iterations: int = 2):
    reflection_log = []
    expand = False
    answer = ""
    graded_chunks: list = []

    for iteration in range(max_iterations):
        extra = expand_query(query) if expand else (decompose_comparison(query) if is_comparison_query(query) else [])
        all_queries = [query] + extra
        all_chunks: list = []
        for q in all_queries:
            all_chunks.extend(hybrid_search(q, chunks, index, bm25, k=12))

        seen: set = set()
        unique_chunks = [c for c in all_chunks if not (c in seen or seen.add(c))]

        boosted = boost_exact_matches(query, unique_chunks)
        reranked_chunks = rerank(query, mmr(query, boosted, top_k=6))
        graded_chunks = grade_retrieval(query, reranked_chunks)

        context = " ".join(graded_chunks[:4])[:3000]
        last_period = context.rfind(".")
        if last_period > 500:
            context = context[:last_period + 1]

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages += chat_history
        messages.append({"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"})

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.2,
            max_tokens=512,
        )
        answer = response.choices[0].message.content

        grade = grade_answer(query, answer, context)
        reflection_log.append({
            "iteration": iteration + 1,
            "expanded": expand,
            "retrieved": len(reranked_chunks),
            "after_grading": len(graded_chunks),
            "faithful": grade.get("faithful", True),
            "relevant": grade.get("relevant", True),
            "reason": grade.get("reason", ""),
        })

        if grade.get("faithful", True) and grade.get("relevant", True):
            return answer, graded_chunks, reflection_log

        expand = True

    return answer, graded_chunks, reflection_log


# ── REQUEST MODELS ────────────────────────────────────────────

class ChatRequest(BaseModel):
    session_id: str
    query: str


# ── ROUTES ───────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not (file.filename or "").endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    content = await file.read()
    session_id = str(uuid.uuid4())

    # Upload PDF to S3 first (fast)
    s3_key = None
    try:
        s3_client = boto3.client("s3", region_name="us-east-1")
        s3_key = f"uploads/{session_id}/{file.filename}"
        s3_client.put_object(
            Bucket=os.getenv("S3_BUCKET", "reflexrag-pdfs"),
            Key=s3_key,
            Body=content,
            ContentType="application/pdf",
        )
        print(f"S3 upload OK: {s3_key}")
    except Exception as e:
        print(f"S3 upload error: {e}")
        raise HTTPException(status_code=500, detail="Failed to store PDF.")

    # Save metadata to RDS
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute(
            "INSERT INTO documents (session_id, filename, chunk_count, s3_key) VALUES (%s, %s, %s, %s)",
            (session_id, file.filename, 0, s3_key),
        )
        db.commit()
        cur.close()
        db.close()
    except Exception as e:
        print(f"DB write error (upload): {e}")

    # Hand off heavy processing to Celery worker
    task = celery_tasks.process_pdf.delay(session_id, s3_key, file.filename)

    return {"task_id": task.id, "session_id": session_id, "filename": file.filename}


@app.get("/task/{task_id}")
async def get_task_status(task_id: str):
    result = AsyncResult(task_id, app=celery_app)

    if result.state == "PENDING":
        return {"state": "PENDING", "status": "Waiting to start..."}

    if result.state == "PROGRESS":
        return {"state": "PROGRESS", "status": result.info.get("status", "")}

    if result.state == "SUCCESS":
        data = result.result
        session_id = data["session_id"]

        # Load from Redis into memory if not already there
        if session_id not in sessions and cache:
            try:
                chunks_raw = cache.get(f"session_chunks:{session_id}")
                index_raw = cache.get(f"session_index:{session_id}")
                if chunks_raw and index_raw:
                    chunks = json.loads(chunks_raw)
                    idx = faiss.deserialize_index(np.frombuffer(index_raw, dtype=np.uint8))
                    bm25 = BM25Okapi([c.lower().split() for c in chunks])
                    sessions[session_id] = {
                        "chunks": chunks,
                        "index": idx,
                        "bm25": bm25,
                        "chat_history": [],
                        "filename": data["filename"],
                    }
                    # Update chunk count in RDS
                    try:
                        db = get_db()
                        cur = db.cursor()
                        cur.execute(
                            "UPDATE documents SET chunk_count = %s WHERE session_id = %s",
                            (data["chunk_count"], session_id),
                        )
                        db.commit()
                        cur.close()
                        db.close()
                    except Exception:
                        pass
            except Exception as e:
                print(f"Session load error: {e}")

        return {"state": "SUCCESS", "session_id": session_id,
                "chunk_count": data["chunk_count"], "filename": data["filename"]}

    if result.state == "FAILURE":
        return {"state": "FAILURE", "status": str(result.info)}

    return {"state": result.state, "status": "Processing..."}


@app.post("/chat")
async def chat(req: ChatRequest):
    session = sessions.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please upload a PDF first.")

    # Check Redis cache before running the expensive pipeline
    cache_key = f"chat:{req.session_id}:{req.query.lower().strip()}"
    if cache:
        cached = cache.get(cache_key)
        if cached:
            return json.loads(cached)

    answer, used_chunks, reflection_log = run_pipeline(
        req.query,
        session["chunks"],
        session["index"],
        session["bm25"],
        session["chat_history"],
    )

    session["chat_history"].append({"role": "user", "content": req.query})
    session["chat_history"].append({"role": "assistant", "content": answer})

    # Store result in Redis with 1-hour TTL
    if cache:
        result = {"answer": answer, "chunks": used_chunks, "reflection_log": reflection_log}
        cache.setex(cache_key, 3600, json.dumps(result))

    # Persist messages to RDS
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, %s, %s), (%s, %s, %s)",
            (req.session_id, "user", req.query, req.session_id, "assistant", answer),
        )
        db.commit()
        cur.close()
        db.close()
    except Exception as e:
        print(f"DB write error (chat): {e}")

    return {"answer": answer, "chunks": used_chunks, "reflection_log": reflection_log}


@app.delete("/session/{session_id}")
async def reset_session(session_id: str):
    if session_id in sessions:
        sessions[session_id]["chat_history"] = []
    return {"status": "ok"}


@app.post("/restore/{session_id}")
async def restore_session(session_id: str):
    # Already in memory — no need to restore
    if session_id in sessions:
        return {"session_id": session_id, "filename": sessions[session_id]["filename"], "chunk_count": len(sessions[session_id]["chunks"])}

    # Look up in RDS
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute("SELECT filename, chunk_count, s3_key FROM documents WHERE session_id = %s", (session_id,))
        doc = cur.fetchone()
        cur.close()
        db.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not doc:
        raise HTTPException(status_code=404, detail="Session not found.")
    if not doc["s3_key"]:
        raise HTTPException(status_code=404, detail="PDF not in S3 — please re-upload.")

    # Download PDF from S3
    try:
        s3_client = boto3.client("s3", region_name="us-east-1")
        obj = s3_client.get_object(Bucket=os.getenv("S3_BUCKET", "reflexrag-pdfs"), Key=doc["s3_key"])
        content = obj["Body"].read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"S3 download failed: {e}")

    # Rebuild index
    reader = PdfReader(BytesIO(content))
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"

    text = restructure_tables(text)
    chunks = chunk_text(clean_text(text))
    if not chunks:
        raise HTTPException(status_code=400, detail="Could not extract text from PDF.")

    embeddings = embed_model.encode(chunks, show_progress_bar=False)
    idx = faiss.IndexFlatL2(embeddings.shape[1])
    idx.add(np.array(embeddings, dtype=np.float32))
    bm25 = BM25Okapi([c.lower().split() for c in chunks])

    sessions[session_id] = {
        "chunks": chunks,
        "index": idx,
        "bm25": bm25,
        "chat_history": [],
        "filename": doc["filename"],
    }

    print(f"Session restored from S3: {session_id}")
    return {"session_id": session_id, "filename": doc["filename"], "chunk_count": len(chunks)}


@app.get("/history/{session_id}")
async def get_history(session_id: str):
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute(
            "SELECT role, content, created_at FROM chat_messages WHERE session_id = %s ORDER BY created_at ASC",
            (session_id,),
        )
        messages = cur.fetchall()
        cur.close()
        db.close()
        return {"session_id": session_id, "messages": messages}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class FeedbackRequest(BaseModel):
    session_id: str
    query: str
    answer: str
    helpful: bool


@app.post("/feedback")
async def submit_feedback(req: FeedbackRequest):
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute(
            "INSERT INTO query_feedback (session_id, query, answer, helpful) VALUES (%s, %s, %s, %s)",
            (req.session_id, req.query, req.answer, req.helpful),
        )
        db.commit()
        cur.close()
        db.close()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sessions")
async def list_sessions():
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute("SELECT session_id, filename, chunk_count, created_at FROM documents ORDER BY created_at DESC LIMIT 20")
        docs = cur.fetchall()
        cur.close()
        db.close()
        return {"sessions": docs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
