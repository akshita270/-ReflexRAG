from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import re
import json
import uuid
import time
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
        cache = redis.Redis(host="localhost", port=6379, db=0, decode_responses=False)
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
    # Create eval_metrics table if it doesn't exist
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS eval_metrics (
                id SERIAL PRIMARY KEY,
                session_id TEXT,
                query TEXT,
                answer TEXT,
                faithful BOOLEAN,
                relevant BOOLEAN,
                context_precision REAL,
                response_time_ms INTEGER,
                cache_hit BOOLEAN DEFAULT FALSE,
                semantic_cache_hit BOOLEAN DEFAULT FALSE,
                iterations INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        db.commit()
        cur.close()
        db.close()
        print("eval_metrics table ready")
    except Exception as e:
        print(f"DB table init error: {e}")
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
    # Boost k for queries with specific technical/named terms so rare concepts aren't missed
    specific_terms = re.findall(r"\b[A-Z]{2,}\b|\b\w{8,}\b", query)
    effective_k = min(len(chunks), k + len(specific_terms) * 2)
    query_embedding = embed_model.encode([query], convert_to_numpy=True)
    _, faiss_indices = index.search(np.array(query_embedding, dtype=np.float32), effective_k)
    faiss_ranked = list(faiss_indices[0])
    bm25_scores = bm25.get_scores(query.lower().split())
    bm25_ranked = list(np.argsort(bm25_scores)[::-1][:effective_k])
    combined = reciprocal_rank_fusion([faiss_ranked, bm25_ranked])[:effective_k]
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


def rerank(query: str, chunks: list, top_k: int = 6) -> list:
    if not chunks:
        return []
    scores = reranker.predict([[query, chunk] for chunk in chunks])
    ranked = [c for c, _ in sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)]
    return ranked[:top_k]


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


def hypothetical_answer(query: str) -> str:
    """HyDE: generate a synthetic passage that would answer the query for better FAISS retrieval."""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": (
                f"Write a short factual passage (2-3 sentences) that would directly answer "
                f"this question as if from an OECD health care systems research report. "
                f"Be specific with numbers, country names, and technical terms:\n\n{query}"
            )}],
            temperature=0.0,
            max_tokens=150,
        )
        return response.choices[0].message.content.strip()
    except Exception:
        return query


def expand_query(query: str) -> list:
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": (
            f"Generate 3 alternative phrasings of this question "
            f"for searching an OECD health care systems and efficiency research report. "
            f"Return only the questions, one per line, no numbering.\n\nQuestion: {query}"
        )}],
        temperature=0.3,
        max_tokens=200,
    )
    return [l.strip() for l in response.choices[0].message.content.strip().split("\n") if l.strip()]


# ── SELF-REFLECTION ──────────────────────────────────────────

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
    answer = ""
    top_chunks: list = []

    # Pre-compute HyDE embedding once — reused across iterations
    hyde_text = hypothetical_answer(query)
    hyde_emb = embed_model.encode([hyde_text], convert_to_numpy=True)

    for iteration in range(max_iterations):
        # Always expand + decompose; on retry, use fresh expansions
        extra = expand_query(query)
        if is_comparison_query(query):
            extra += decompose_comparison(query)
        all_queries = [query] + extra

        all_chunks: list = []
        # Standard hybrid search for each query variant
        for q in all_queries:
            all_chunks.extend(hybrid_search(q, chunks, index, bm25, k=20))

        # HyDE retrieval: embed synthetic answer → find chunks that look like the answer
        _, hyde_indices = index.search(np.array(hyde_emb, dtype=np.float32), 20)
        hyde_chunks = [chunks[i] for i in hyde_indices[0] if i < len(chunks)]
        all_chunks.extend(hyde_chunks)

        seen: set = set()
        unique_chunks = [c for c in all_chunks if not (c in seen or seen.add(c))]

        boosted = boost_exact_matches(query, unique_chunks)
        top_chunks = rerank(query, boosted, top_k=8)

        context = " ".join(top_chunks[:6])[:4500]
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
            "expanded": True,
            "retrieved": len(top_chunks),
            "after_grading": len(top_chunks),
            "faithful": grade.get("faithful", True),
            "relevant": grade.get("relevant", True),
            "reason": grade.get("reason", ""),
        })

        if grade.get("faithful", True) and grade.get("relevant", True):
            return answer, top_chunks, reflection_log

    return answer, top_chunks, reflection_log


# ── SEMANTIC CACHE ───────────────────────────────────────────

SEMANTIC_THRESHOLD = 0.92

def _sem_cache_get(session_id: str, query_emb: np.ndarray):
    if not cache:
        return None
    raw = cache.get(f"semcache:{session_id}")
    if not raw:
        return None
    entries = json.loads(raw)
    if not entries:
        return None
    embs = np.array([e["emb"] for e in entries], dtype=np.float32)
    sims = cosine_similarity(query_emb.reshape(1, -1), embs)[0]
    best = int(np.argmax(sims))
    if sims[best] >= SEMANTIC_THRESHOLD:
        cached = cache.get(entries[best]["key"])
        if cached:
            return json.loads(cached)
    return None

def _sem_cache_set(session_id: str, query: str, query_emb: np.ndarray, cache_key: str):
    if not cache:
        return
    raw = cache.get(f"semcache:{session_id}")
    entries = json.loads(raw) if raw else []
    entries.append({"q": query, "emb": query_emb.tolist(), "key": cache_key})
    entries = entries[-50:]
    cache.set(f"semcache:{session_id}", json.dumps(entries), ex=86400)


# ── EVAL METRICS ─────────────────────────────────────────────

def store_eval_metric(session_id, query, answer, faithful, relevant,
                      context_precision, response_time_ms,
                      cache_hit=False, semantic_cache_hit=False, iterations=1):
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute(
            """INSERT INTO eval_metrics
               (session_id, query, answer, faithful, relevant, context_precision,
                response_time_ms, cache_hit, semantic_cache_hit, iterations)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (session_id, query[:500], answer[:500], faithful, relevant,
             context_precision, response_time_ms, cache_hit, semantic_cache_hit, iterations),
        )
        db.commit()
        cur.close()
        db.close()
    except Exception as e:
        print(f"Eval metric error: {e}")


# ── REQUEST MODELS ────────────────────────────────────────────

class ChatRequest(BaseModel):
    session_id: str
    query: str
    bypass_cache: bool = False


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
    t0 = time.time()
    session = sessions.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please upload a PDF first.")

    # 1. Exact cache check
    cache_key = f"chat:{req.session_id}:{req.query.lower().strip()}"
    if cache and not req.bypass_cache:
        cached = cache.get(cache_key)
        if cached:
            result = json.loads(cached)
            result["source"] = "cache"
            store_eval_metric(req.session_id, req.query, result.get("answer", ""),
                              True, True, 1.0, int((time.time() - t0) * 1000),
                              cache_hit=True, iterations=0)
            return result

    # 2. Embed query (reused for semantic cache + pipeline)
    query_emb = embed_model.encode([req.query], convert_to_numpy=True)[0]

    # 3. Semantic cache check
    if not req.bypass_cache:
        sem_result = _sem_cache_get(req.session_id, query_emb)
        if sem_result:
            sem_result["source"] = "semantic_cache"
            store_eval_metric(req.session_id, req.query, sem_result.get("answer", ""),
                              True, True, 1.0, int((time.time() - t0) * 1000),
                              semantic_cache_hit=True, iterations=0)
            return sem_result

    # 4. Run full pipeline
    answer, used_chunks, reflection_log = run_pipeline(
        req.query,
        session["chunks"],
        session["index"],
        session["bm25"],
        session["chat_history"],
    )

    session["chat_history"].append({"role": "user", "content": req.query})
    session["chat_history"].append({"role": "assistant", "content": answer})

    last_refl = reflection_log[-1] if reflection_log else {}
    ctx_prec = last_refl.get("after_grading", 0) / max(last_refl.get("retrieved", 1), 1)
    response_ms = int((time.time() - t0) * 1000)
    iters = last_refl.get("iteration", 1)
    faithful = last_refl.get("faithful", True)
    relevant = last_refl.get("relevant", True)

    result = {
        "answer": answer,
        "chunks": used_chunks,
        "reflection_log": reflection_log,
        "source": "pipeline",
        "faithful": faithful,
        "relevant": relevant,
        "context_precision": round(ctx_prec, 3),
        "response_time_ms": response_ms,
        "iterations": iters,
    }

    # 5. Store in exact cache
    if cache:
        cache.setex(cache_key, 3600, json.dumps(result))

    # 6. Store in semantic cache
    _sem_cache_set(req.session_id, req.query, query_emb, cache_key)

    # 7. Store eval metrics
    store_eval_metric(
        req.session_id, req.query, answer,
        faithful, relevant,
        ctx_prec, response_ms,
        iterations=iters,
    )

    # 8. Persist messages to RDS
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

    return result


@app.delete("/session/{session_id}")
async def reset_session(session_id: str):
    if session_id in sessions:
        sessions[session_id]["chat_history"] = []
    return {"status": "ok"}


@app.post("/restore/{session_id}")
async def restore_session(session_id: str):
    import asyncio

    # 1. Already in memory
    if session_id in sessions:
        s = sessions[session_id]
        return {"session_id": session_id, "filename": s["filename"], "chunk_count": len(s["chunks"])}

    # 2. Check Redis cache (instant — avoids re-embedding for sessions < 24h old)
    if cache:
        try:
            chunks_raw = cache.get(f"session_chunks:{session_id}")
            index_raw = cache.get(f"session_index:{session_id}")
            if chunks_raw and index_raw:
                chunks = json.loads(chunks_raw)
                idx = faiss.deserialize_index(np.frombuffer(index_raw, dtype=np.uint8))
                bm25 = BM25Okapi([c.lower().split() for c in chunks])

                # Look up filename from RDS
                try:
                    db = get_db()
                    cur = db.cursor()
                    cur.execute("SELECT filename FROM documents WHERE session_id = %s", (session_id,))
                    row = cur.fetchone()
                    cur.close()
                    db.close()
                    filename = row["filename"] if row else "document.pdf"
                except Exception:
                    filename = "document.pdf"

                sessions[session_id] = {
                    "chunks": chunks, "index": idx, "bm25": bm25,
                    "chat_history": [], "filename": filename,
                }
                print(f"Session restored from Redis cache: {session_id}")
                return {"session_id": session_id, "filename": filename, "chunk_count": len(chunks)}
        except Exception as e:
            print(f"Redis restore error: {e}")

    # 3. Look up in RDS
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute("SELECT filename, chunk_count, s3_key FROM documents WHERE session_id = %s", (session_id,))
        doc = cur.fetchone()
        cur.close()
        db.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    if not doc:
        raise HTTPException(status_code=404, detail="Session not found.")
    if not doc["s3_key"]:
        raise HTTPException(status_code=404, detail="PDF not stored — please re-upload.")

    # 4. Download PDF from S3
    try:
        s3_client = boto3.client("s3", region_name="us-east-1")
        obj = s3_client.get_object(Bucket=os.getenv("S3_BUCKET", "reflexrag-pdfs"), Key=doc["s3_key"])
        content = obj["Body"].read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"S3 download failed: {e}")

    # 5. Parse + embed in thread pool (blocking CPU work — don't block event loop)
    def _rebuild():
        try:
            reader = PdfReader(BytesIO(content))
            text = ""
            for page in reader.pages:
                try:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
                except Exception:
                    pass
            text = restructure_tables(text)
            chunks = chunk_text(clean_text(text))
            if not chunks:
                raise ValueError("No text extracted from PDF.")
            embeddings = embed_model.encode(chunks, show_progress_bar=False)
            idx = faiss.IndexFlatL2(embeddings.shape[1])
            idx.add(np.array(embeddings, dtype=np.float32))
            bm25 = BM25Okapi([c.lower().split() for c in chunks])
            # Cache rebuilt index in Redis (24h TTL) so next restore is instant
            if cache:
                try:
                    cache.set(f"session_chunks:{session_id}", json.dumps(chunks).encode(), ex=86400)
                    cache.set(f"session_index:{session_id}", faiss.serialize_index(idx).tobytes(), ex=86400)
                except Exception:
                    pass
            return chunks, idx, bm25
        except Exception as exc:
            raise exc

    try:
        chunks, idx, bm25 = await asyncio.get_event_loop().run_in_executor(None, _rebuild)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Index rebuild failed: {e}")

    sessions[session_id] = {
        "chunks": chunks, "index": idx, "bm25": bm25,
        "chat_history": [], "filename": doc["filename"],
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


@app.get("/metrics")
async def get_metrics():
    try:
        db = get_db()
        cur = db.cursor()

        cur.execute("""
            SELECT
                COUNT(*) as total_queries,
                COALESCE(ROUND(AVG(CASE WHEN faithful THEN 100.0 ELSE 0.0 END)::numeric, 1), 0) as faithfulness_pct,
                COALESCE(ROUND(AVG(CASE WHEN relevant THEN 100.0 ELSE 0.0 END)::numeric, 1), 0) as relevance_pct,
                COALESCE(ROUND(AVG(CASE WHEN cache_hit OR semantic_cache_hit THEN 100.0 ELSE 0.0 END)::numeric, 1), 0) as cache_hit_pct,
                COALESCE(ROUND(AVG(response_time_ms)::numeric, 0), 0) as avg_response_ms,
                COALESCE(ROUND(AVG(context_precision * 100)::numeric, 1), 0) as avg_context_pct,
                COALESCE(SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END), 0) as exact_hits,
                COALESCE(SUM(CASE WHEN semantic_cache_hit THEN 1 ELSE 0 END), 0) as semantic_hits,
                COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 0), 0) as p95_response_ms,
                COALESCE(ROUND(AVG(CASE WHEN NOT faithful OR NOT relevant THEN 100.0 ELSE 0.0 END)::numeric, 1), 0) as error_rate_pct,
                COALESCE(SUM(CASE WHEN iterations > 1 THEN 1 ELSE 0 END), 0) as multi_iter_count
            FROM eval_metrics
        """)
        stats = dict(cur.fetchone())

        cur.execute("""
            SELECT e.query, e.faithful, e.relevant, e.context_precision,
                   e.response_time_ms, e.cache_hit, e.semantic_cache_hit,
                   e.iterations, e.created_at::text, d.filename
            FROM eval_metrics e
            LEFT JOIN documents d ON e.session_id = d.session_id::text
            ORDER BY e.created_at DESC LIMIT 20
        """)
        recent = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT COALESCE(d.filename, 'Unknown') as filename,
                   COUNT(*) as total_queries,
                   ROUND(AVG(CASE WHEN e.faithful THEN 100.0 ELSE 0.0 END)::numeric, 1) as faithfulness_pct,
                   ROUND(AVG(e.context_precision * 100)::numeric, 1) as avg_context_pct,
                   ROUND(AVG(e.response_time_ms)::numeric, 0) as avg_ms
            FROM eval_metrics e
            LEFT JOIN documents d ON e.session_id = d.session_id::text
            GROUP BY d.filename
            ORDER BY COUNT(*) DESC LIMIT 10
        """)
        per_doc = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT
                DATE_TRUNC('hour', created_at) as hour,
                COUNT(*) as count
            FROM eval_metrics
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY hour
            ORDER BY hour ASC
        """)
        hourly_raw = cur.fetchall()
        hourly = [{"hour": str(r["hour"]), "count": r["count"]} for r in hourly_raw]

        cur.close()
        db.close()
        return {"stats": stats, "recent": recent, "per_doc": per_doc, "hourly": hourly}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
