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
import pdfplumber
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

SYSTEM_PROMPT = """You are a precise document analyst. Answer using ONLY the information in the provided context.

Rules:
1. Every factual claim must be directly supported by the context. Numbers, country names, and percentages must appear in the context — never invent them.
2. NEVER add facts not explicitly stated. Do not extrapolate or guess.
3. If the context contains partial or related information, answer with what IS there — do not say NOT FOUND just because the exact phrasing differs.
4. Only say "NOT FOUND in the provided context." if the context contains NO information relevant to the question at all.
5. Keep answers concise and grounded."""

REFLECTION_SYSTEM = (
    "You are a strict evaluator for a clinical RAG system. "
    "Be concise and respond only with valid JSON."
)


# ── TEXT PROCESSING ──────────────────────────────────────────

def restructure_tables(raw_text: str) -> str:
    """Pass-through — document-specific table restructuring removed."""
    return raw_text


def clean_text(text: str) -> str:
    # Rejoin words hyphenated across line breaks
    text = re.sub(r"(\w+)-\s*\n\s*(\w+)", r"\1\2", text)
    # Collapse whitespace but preserve paragraph breaks (double newline)
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Remove page headers/footers that are just numbers or short lines
    text = re.sub(r"(?m)^\s*\d{1,3}\s*$", "", text)
    return text.strip()


def is_valid_chunk(chunk: str, min_words: int = 20) -> bool:
    words = chunk.split()
    if len(words) < min_words:
        return False
    # Skip chunks that are mostly dots (table of contents lines)
    if chunk.count("..") > 4:
        return False
    # Skip chunks that are mostly numbers (page number lists, figure labels)
    alpha_ratio = sum(c.isalpha() for c in chunk) / max(len(chunk), 1)
    if alpha_ratio < 0.4:
        return False
    return True


def chunk_text(text: str, chunk_size: int = 750, overlap: int = 150) -> list:
    """
    Paragraph-aware chunker. Tries to keep paragraphs intact; only splits
    on sentence boundaries when a paragraph exceeds chunk_size.
    """
    # Split on double newlines first (paragraph breaks) then fall back to sentences
    paragraphs = re.split(r"\n{2,}", text)
    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current) + len(para) + 2 <= chunk_size:
            current = (current + "\n\n" + para).strip() if current else para
        else:
            if current:
                chunks.append(current)
                # Carry overlap from end of current into next chunk
                overlap_text = current[-overlap:] if len(current) > overlap else current
                current = overlap_text + "\n\n" + para
            else:
                # Single paragraph exceeds chunk_size — split on sentences
                sentences = re.split(r"(?<=[.?!])\s+", para)
                for sent in sentences:
                    if len(current) + len(sent) + 1 <= chunk_size:
                        current = (current + " " + sent).strip() if current else sent
                    else:
                        if current:
                            chunks.append(current)
                            overlap_text = current[-overlap:] if len(current) > overlap else current
                            current = overlap_text + " " + sent
                        else:
                            current = sent

    if current.strip():
        chunks.append(current.strip())

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
                    f"Context:\n{context[:2000]}\n\n"
                    f"Question: {query}\n\nAnswer: {answer}\n\n"
                    f"Grade this answer strictly:\n"
                    f"- faithful=true ONLY if every specific fact (numbers, names, percentages, lists) "
                    f"in the answer is EXPLICITLY stated in the context above — not inferred or paraphrased.\n"
                    f"- faithful=false if the answer adds any fact not directly in the context, "
                    f"or contradicts the context.\n"
                    f"- relevant=true if the answer addresses the question topic.\n"
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

RETRY_SYSTEM = """You are a precise document analyst. Answer using ONLY the information in the provided context.

Rules:
1. Every factual claim must be directly supported by the context. Numbers, country names, and percentages must appear in the context — never invent them.
2. NEVER add facts not explicitly stated. Do not extrapolate or guess.
3. Look carefully — the answer may be expressed with slightly different wording than the question uses. Synonyms and paraphrases count.
4. If the context mentions ANY related information, use it. Only say "NOT FOUND in the provided context." if there is truly zero relevant content.
5. Keep answers concise and grounded."""


def retrieval_confidence(query: str, top_chunks: list) -> float:
    """Cross-encoder max score of (query, chunk) — low score means poor retrieval."""
    if not top_chunks:
        return 0.0
    scores = reranker.predict([[query, c] for c in top_chunks[:6]])
    return float(max(scores))


def run_pipeline(query: str, chunks: list, index, bm25, chat_history: list, max_iterations: int = 2):
    reflection_log = []
    answer = ""
    top_chunks: list = []

    # Pre-compute HyDE embedding once — reused across iterations
    hyde_text = hypothetical_answer(query)
    hyde_emb = embed_model.encode([hyde_text], convert_to_numpy=True)

    for iteration in range(max_iterations):
        extra = expand_query(query)
        if is_comparison_query(query):
            extra += decompose_comparison(query)
        all_queries = [query] + extra

        # Iteration 2 uses wider retrieval to find content missed on iteration 1
        k_per_query = 25 if iteration == 0 else 35

        all_chunks: list = []
        for q in all_queries:
            all_chunks.extend(hybrid_search(q, chunks, index, bm25, k=k_per_query))

        # HyDE retrieval
        hyde_k = 25 if iteration == 0 else 35
        _, hyde_indices = index.search(np.array(hyde_emb, dtype=np.float32), hyde_k)
        hyde_chunks = [chunks[i] for i in hyde_indices[0] if i < len(chunks)]
        all_chunks.extend(hyde_chunks)

        seen: set = set()
        unique_chunks = [c for c in all_chunks if not (c in seen or seen.add(c))]

        boosted = boost_exact_matches(query, unique_chunks)
        top_k_rerank = 8 if iteration == 0 else 12
        top_chunks = rerank(query, boosted, top_k=top_k_rerank)

        # Use more context on iteration 2 since iteration 1 failed
        context_slots = 6 if iteration == 0 else 10
        context = "\n\n".join(top_chunks[:context_slots])
        if len(context) > 6000:
            context = context[:6000]
            last_period = context.rfind(".")
            if last_period > 500:
                context = context[:last_period + 1]

        # Iteration 2 uses RETRY_SYSTEM (same rules, but emphasizes synonyms/paraphrases)
        system = RETRY_SYSTEM if iteration > 0 else SYSTEM_PROMPT
        messages = [{"role": "system", "content": system}]
        messages += chat_history
        messages.append({"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"})

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.0,
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
async def restore_session(session_id: str, force: bool = False):
    import asyncio

    # force=true flushes cached chunks so the session is re-indexed from S3
    if force and cache:
        cache.delete(f"session_chunks:{session_id}")
        cache.delete(f"session_index:{session_id}")
        cache.delete(f"semcache:{session_id}")
    if force and session_id in sessions:
        del sessions[session_id]

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
            text = ""
            with pdfplumber.open(BytesIO(content)) as pdf:
                for page in pdf.pages:
                    try:
                        page_text = page.extract_text(layout=True)
                        if page_text:
                            text += page_text + "\n\n"
                    except Exception:
                        pass
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


@app.post("/reindex/{session_id}")
async def reindex_session(session_id: str):
    """Force re-chunk a session from S3 using the current chunker. Call after chunker updates."""
    if cache:
        cache.delete(f"session_chunks:{session_id}")
        cache.delete(f"session_index:{session_id}")
        cache.delete(f"semcache:{session_id}")
    if session_id in sessions:
        del sessions[session_id]
    # Now restore fresh from S3
    return await restore_session(session_id)


@app.get("/debug/search/{session_id}")
async def debug_search(session_id: str, q: str, k: int = 10):
    """Return top-k retrieved chunks for a query — useful for diagnosing retrieval failures."""
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Call /restore first.")
    all_chunks = hybrid_search(q, session["chunks"], session["index"], session["bm25"], k=k)
    boosted = boost_exact_matches(q, all_chunks)
    reranked = rerank(q, boosted, top_k=k)
    return {
        "query": q,
        "chunk_count": len(session["chunks"]),
        "top_chunks": [{"rank": i + 1, "text": c[:300]} for i, c in enumerate(reranked)],
    }


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
