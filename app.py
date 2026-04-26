import streamlit as st
import re
import json
import numpy as np
import faiss
import os
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer, CrossEncoder
from rank_bm25 import BM25Okapi
from sklearn.metrics.pairwise import cosine_similarity
from groq import Groq

# ── PAGE CONFIG ──────────────────────────────────────────────
st.set_page_config(
    page_title="Clinical RAG Assistant",
    page_icon="🧠",
    layout="wide"
)

# ── CUSTOM CSS ───────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap');

* { font-family: 'DM Sans', sans-serif; }

.stApp {
    background: #0a0a0f;
    color: #e8e8f0;
}

h1, h2, h3 {
    font-family: 'Space Mono', monospace !important;
    color: #00ff9d !important;
}

.main-header {
    font-family: 'Space Mono', monospace;
    font-size: 2rem;
    color: #00ff9d;
    border-bottom: 2px solid #00ff9d33;
    padding-bottom: 0.5rem;
    margin-bottom: 1.5rem;
}

.sub-header {
    color: #888899;
    font-size: 0.9rem;
    margin-top: -1rem;
    margin-bottom: 2rem;
}

.chunk-card {
    background: #12121f;
    border: 1px solid #2a2a3f;
    border-left: 3px solid #00ff9d;
    border-radius: 8px;
    padding: 1rem 1.2rem;
    margin-bottom: 0.8rem;
    font-size: 0.85rem;
    color: #b0b0c8;
    line-height: 1.6;
}

.chunk-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    color: #00ff9d;
    margin-bottom: 0.4rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
}

.answer-box {
    background: #0d1f17;
    border: 1px solid #00ff9d44;
    border-radius: 10px;
    padding: 1.2rem 1.5rem;
    color: #e8e8f0;
    line-height: 1.8;
    font-size: 0.95rem;
}

.not-found-box {
    background: #1f0d0d;
    border: 1px solid #ff4d4d44;
    border-radius: 10px;
    padding: 1.2rem 1.5rem;
    color: #ffaaaa;
    line-height: 1.8;
}

.status-badge {
    display: inline-block;
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    padding: 0.2rem 0.6rem;
    border-radius: 20px;
    background: #00ff9d22;
    color: #00ff9d;
    border: 1px solid #00ff9d44;
    margin-bottom: 1rem;
}

.stChatMessage {
    background: #12121f !important;
    border: 1px solid #2a2a3f !important;
    border-radius: 10px !important;
}

section[data-testid="stSidebar"] {
    background: #0d0d18 !important;
    border-right: 1px solid #2a2a3f !important;
}

.stButton > button {
    background: #00ff9d11 !important;
    border: 1px solid #00ff9d44 !important;
    color: #00ff9d !important;
    font-family: 'Space Mono', monospace !important;
    font-size: 0.8rem !important;
    border-radius: 6px !important;
    transition: all 0.2s !important;
}

.stButton > button:hover {
    background: #00ff9d22 !important;
    border-color: #00ff9d !important;
}

.stFileUploader {
    border: 1px dashed #2a2a3f !important;
    border-radius: 10px !important;
    background: #12121f !important;
}

div[data-testid="stExpander"] {
    background: #12121f !important;
    border: 1px solid #2a2a3f !important;
    border-radius: 8px !important;
}

.pipeline-step {
    font-family: 'Space Mono', monospace;
    font-size: 0.75rem;
    color: #555570;
    padding: 0.3rem 0;
}

.pipeline-step.active {
    color: #00ff9d;
}
</style>
""", unsafe_allow_html=True)


# ── LOAD MODELS (cached) ─────────────────────────────────────
@st.cache_resource
def load_models():
    embed_model = SentenceTransformer('all-MiniLM-L6-v2')
    reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
    return embed_model, reranker

embed_model, reranker = load_models()


# ── GROQ CLIENT ──────────────────────────────────────────────
@st.cache_resource
def get_groq_client():
    api_key = st.secrets.get("GROQ_API_KEY", os.environ.get("GROQ_API_KEY", ""))
    return Groq(api_key=api_key)

client = get_groq_client()

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


def grade_retrieval(query, chunks):
    """Ask LLM to filter chunks to only those relevant to the query."""
    if not chunks:
        return []
    chunk_list = "\n\n".join([f"[{i+1}] {c[:300]}" for i, c in enumerate(chunks)])
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": REFLECTION_SYSTEM},
                {"role": "user", "content": (
                    f"Query: {query}\n\n"
                    f"Rate each chunk as relevant (Y) or not (N) to the query.\n"
                    f"Chunks:\n{chunk_list}\n\n"
                    f"Respond ONLY with JSON: {{\"grades\": [\"Y\", \"N\", ...]}} "
                    f"— one grade per chunk in order."
                )}
            ],
            temperature=0.0,
            max_tokens=80
        )
        text = response.choices[0].message.content.strip()
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            data = json.loads(match.group())
            grades = data.get("grades", [])
            relevant = [c for c, g in zip(chunks, grades) if str(g).upper() == "Y"]
            return relevant if relevant else chunks
    except Exception:
        pass
    return chunks


def grade_answer(query, answer, context):
    """Grade the generated answer for faithfulness and relevance."""
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": REFLECTION_SYSTEM},
                {"role": "user", "content": (
                    f"Context: {context[:1200]}\n\n"
                    f"Question: {query}\n\n"
                    f"Answer: {answer}\n\n"
                    f"Grade this answer with JSON:\n"
                    f"{{\"faithful\": true/false, \"relevant\": true/false, \"reason\": \"one sentence\"}}\n"
                    f"faithful = answer is grounded in context (no hallucination)\n"
                    f"relevant = answer actually addresses the question"
                )}
            ],
            temperature=0.0,
            max_tokens=120
        )
        text = response.choices[0].message.content.strip()
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except Exception:
        pass
    return {"faithful": True, "relevant": True, "reason": "grading unavailable"}


# ── PDF PROCESSING FUNCTIONS ─────────────────────────────────
def load_pdf(uploaded_file):
    reader = PdfReader(uploaded_file)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'\n+', '\n', text)
    text = re.sub(r'(\w+)-\s+(\w+)', r'\1\2', text)
    return text.strip()


def preprocess_tables(text):
    # Must run on RAW text before clean_text collapses spaces
    lines = text.split("\n")
    processed = []
    i = 0
    while i < len(lines):
        raw_line = lines[i]
        line = raw_line.strip()
        cells = [c.strip() for c in re.split(r"\t|\s{2,}", line) if c.strip()]
        if len(cells) >= 3:
            table_rows = [cells]
            i += 1
            while i < len(lines):
                next_cells = [c.strip() for c in re.split(r"\t|\s{2,}", lines[i].strip()) if c.strip()]
                if len(next_cells) >= 2:
                    table_rows.append(next_cells)
                    i += 1
                else:
                    break
            if len(table_rows) >= 2:
                headers = table_rows[0]
                processed.append(". ".join(headers) + ".")
                for row in table_rows[1:]:
                    pairs = [f"{headers[j] if j < len(headers) else f'col{j+1}'}: {val}" for j, val in enumerate(row)]
                    processed.append("TABLE_ROW: " + ". ".join(pairs) + ".")
            else:
                processed.append(" | ".join(table_rows[0]))
        else:
            processed.append(raw_line)
            i += 1
    return "\n".join(processed)


def boost_exact_matches(query, chunks):
    words = [w.lower() for w in re.findall(r"\b\w{4,}\b", query)]
    high, normal = [], []
    for chunk in chunks:
        (high if any(w in chunk.lower() for w in words) else normal).append(chunk)
    return high + normal

def is_valid_chunk(chunk, min_words=15):
    if chunk.startswith("TABLE_ROW:"):
        return True
    words = chunk.split()
    if len(words) < min_words:
        return False
    if chunk.count('...') > 3:
        return False
    if chunk.count('....') > 2:
        return False
    roman = re.findall(r'\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b', chunk.lower())
    if len(roman) > 5:
        return False
    return True

def chunk_text(text, chunk_size=600, overlap=100):
    sentences = re.split(r'(?<=[.?!])\s+', text)
    chunks = []
    current_chunk = ""
    for sentence in sentences:
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

@st.cache_resource
def build_index(_chunks):
    embeddings = embed_model.encode(_chunks, show_progress_bar=False)
    idx = faiss.IndexFlatL2(embeddings.shape[1])
    idx.add(np.array(embeddings, dtype=np.float32))
    tokenized = [c.lower().split() for c in _chunks]
    from rank_bm25 import BM25Okapi
    bm25 = BM25Okapi(tokenized)
    return idx, bm25, embeddings


# ── RETRIEVAL FUNCTIONS ──────────────────────────────────────
def reciprocal_rank_fusion(ranked_lists, k=60):
    scores = {}
    for ranked in ranked_lists:
        for rank, idx in enumerate(ranked):
            scores[idx] = scores.get(idx, 0) + 1 / (k + rank + 1)
    return sorted(scores, key=scores.get, reverse=True)

def hybrid_search(query, chunks, index, bm25, k=12):
    query_embedding = embed_model.encode([query], convert_to_numpy=True)
    _, faiss_indices = index.search(np.array(query_embedding, dtype=np.float32), k)
    faiss_ranked = list(faiss_indices[0])
    tokenized_query = query.lower().split()
    bm25_scores = bm25.get_scores(tokenized_query)
    bm25_ranked = list(np.argsort(bm25_scores)[::-1][:k])
    combined = reciprocal_rank_fusion([faiss_ranked, bm25_ranked])[:k]
    return [chunks[i] for i in combined]

def mmr(query, retrieved_chunks, lambda_param=0.7, top_k=4):
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
                selected_embs = chunk_embs[selected]
                diversity = max(cosine_similarity(emb, selected_embs.reshape(len(selected), -1))[0])
            else:
                diversity = 0.0
            score = lambda_param * relevance - (1 - lambda_param) * diversity
            scores.append((i, score))
        best_idx = max(scores, key=lambda x: x[1])[0]
        selected.append(best_idx)
        candidate_indices.remove(best_idx)
    return [retrieved_chunks[i] for i in selected]

def rerank(query, chunks):
    if not chunks:
        return []
    pairs = [[query, chunk] for chunk in chunks]
    scores = reranker.predict(pairs)
    ranked = sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)
    return [chunk for chunk, _ in ranked]

COMPARISON_PATTERNS = re.compile(
    r"\b(differ|difference|compare|comparison|vs|versus|distinguish|contrast)\b", re.I
)

def is_comparison_query(query):
    return bool(COMPARISON_PATTERNS.search(query))


def decompose_comparison(query):
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


def expand_query(query):
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{
            "role": "user",
            "content": (
                f"Generate 3 alternative phrasings of this question "
                f"for searching a neuroscience research paper. "
                f"Return only the questions, one per line, no numbering.\n\n"
                f"Question: {query}"
            )
        }],
        temperature=0.5,
        max_tokens=200
    )
    return response.choices[0].message.content.strip().split('\n')


# ── FULL PIPELINE WITH SELF-REFLECTION ───────────────────────
def run_pipeline(query, chunks, index, bm25, chat_history, max_iterations=2):
    """
    Self-reflection RAG loop:
      1. Hybrid search → MMR → Rerank
      2. [Reflect] Grade retrieval — filter irrelevant chunks
      3. Generate answer
      4. [Reflect] Grade answer — check faithfulness + relevance
      5. If grades fail, expand query and retry (up to max_iterations)
    """
    reflection_log = []
    expand = False

    for iteration in range(max_iterations):
        all_chunks = []

        if expand:
            extra = expand_query(query)
        elif is_comparison_query(query):
            extra = decompose_comparison(query)
        else:
            extra = []
        all_queries = [query] + extra

        for q in all_queries:
            results = hybrid_search(q, chunks, index, bm25, k=12)
            all_chunks.extend(results)

        # Deduplicate
        seen = set()
        unique_chunks = []
        for c in all_chunks:
            if c not in seen:
                seen.add(c)
                unique_chunks.append(c)

        boosted = boost_exact_matches(query, unique_chunks)
        mmr_results = mmr(query, boosted, top_k=6)
        reranked_chunks = rerank(query, mmr_results)

        # [REFLECT 1] Grade retrieval — keep only relevant chunks
        graded_chunks = grade_retrieval(query, reranked_chunks)

        # Build context from graded chunks
        context = " ".join(graded_chunks[:4])[:3000]
        last_period = context.rfind('.')
        if last_period > 500:
            context = context[:last_period + 1]

        # Generate answer
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages += chat_history
        messages.append({"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"})

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=0.2,
            max_tokens=512
        )
        answer = response.choices[0].message.content

        # [REFLECT 2] Grade answer — faithfulness + relevance
        grade = grade_answer(query, answer, context)
        reflection_log.append({
            "iteration": iteration + 1,
            "expanded": expand,
            "retrieved": len(reranked_chunks),
            "after_grading": len(graded_chunks),
            "faithful": grade.get("faithful", True),
            "relevant": grade.get("relevant", True),
            "reason": grade.get("reason", "")
        })

        if grade.get("faithful", True) and grade.get("relevant", True):
            return answer, graded_chunks, reflection_log

        # Grade failed — try next iteration with query expansion
        expand = True

    # Return best attempt after exhausting iterations
    return answer, graded_chunks, reflection_log


# ── SESSION STATE ────────────────────────────────────────────
if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
if "messages" not in st.session_state:
    st.session_state.messages = []
if "chunks" not in st.session_state:
    st.session_state.chunks = None
if "index" not in st.session_state:
    st.session_state.index = None
if "bm25" not in st.session_state:
    st.session_state.bm25 = None
if "pdf_name" not in st.session_state:
    st.session_state.pdf_name = None


# ── SIDEBAR ──────────────────────────────────────────────────
with st.sidebar:
    st.markdown('<p class="main-header">🧠 RAG</p>', unsafe_allow_html=True)
    st.markdown('<p class="sub-header">Clinical PDF Assistant</p>', unsafe_allow_html=True)

    st.markdown("### Upload PDF")
    uploaded_file = st.file_uploader("", type="pdf", label_visibility="collapsed")

    if uploaded_file:
        if st.session_state.pdf_name != uploaded_file.name:
            with st.spinner("Processing PDF..."):
                raw_text = load_pdf(uploaded_file)
                cleaned = clean_text(preprocess_tables(raw_text))
                chunks = chunk_text(cleaned)
                index, bm25, _ = build_index(tuple(chunks))
                st.session_state.chunks = chunks
                st.session_state.index = index
                st.session_state.bm25 = bm25
                st.session_state.pdf_name = uploaded_file.name
                st.session_state.chat_history = []
                st.session_state.messages = []
            st.success(f"✅ {len(chunks)} chunks indexed")

    st.divider()

    st.markdown("### Pipeline")
    steps = [
        "PDF Load & Clean", "Sentence Chunking", "FAISS + BM25 Index",
        "Hybrid Search (RRF)", "MMR Diversity", "Cross-Encoder Rerank",
        "Retrieval Grading ✦", "Groq LLaMA 3.3 70B", "Answer Grading ✦"
    ]
    for step in steps:
        active = st.session_state.chunks is not None
        cls = "active" if active else ""
        st.markdown(f'<div class="pipeline-step {cls}">→ {step}</div>', unsafe_allow_html=True)
    st.caption("✦ Self-Reflection steps")

    st.divider()

    if st.button("🔄 Reset Chat"):
        st.session_state.chat_history = []
        st.session_state.messages = []
        st.rerun()

    if st.session_state.pdf_name:
        st.markdown(f"**Loaded:** `{st.session_state.pdf_name}`")
        st.markdown(f"**Chunks:** `{len(st.session_state.chunks)}`")


# ── MAIN AREA ────────────────────────────────────────────────
st.markdown('<p class="main-header">Clinical Research Assistant</p>', unsafe_allow_html=True)
st.markdown('<p class="sub-header">Hybrid Search · MMR · Reranking · Chat Memory · Self-Reflection RAG</p>', unsafe_allow_html=True)

if not st.session_state.chunks:
    st.info("👈 Upload a clinical PDF from the sidebar to get started.")
else:
    # Display chat history
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            if msg["role"] == "assistant":
                is_not_found = msg["content"].startswith("NOT FOUND")
                box_class = "not-found-box" if is_not_found else "answer-box"
                st.markdown(f'<div class="{box_class}">{msg["content"]}</div>', unsafe_allow_html=True)
                if "chunks" in msg:
                    with st.expander("📄 Retrieved Chunks"):
                        for i, chunk in enumerate(msg["chunks"]):
                            st.markdown(f'<div class="chunk-label">Chunk {i+1}</div><div class="chunk-card">{chunk}</div>', unsafe_allow_html=True)
                if "reflection_log" in msg and msg["reflection_log"]:
                    with st.expander("🔍 Self-Reflection Log"):
                        for entry in msg["reflection_log"]:
                            st.markdown(
                                f"**Iteration {entry['iteration']}** {'(with query expansion)' if entry['expanded'] else ''}\n"
                                f"- Chunks retrieved: {entry['retrieved']} → after grading: {entry['after_grading']}\n"
                                f"- Faithful: {'✓' if entry['faithful'] else '✗'}  |  "
                                f"Relevant: {'✓' if entry['relevant'] else '✗'}\n"
                                f"- Reason: _{entry['reason']}_"
                            )
            else:
                st.markdown(msg["content"])

    # Chat input
    if prompt := st.chat_input("Ask anything about the PDF..."):
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)

        with st.chat_message("assistant"):
            with st.spinner("Searching, reflecting, and generating answer..."):
                answer, used_chunks, reflection_log = run_pipeline(
                    prompt,
                    st.session_state.chunks,
                    st.session_state.index,
                    st.session_state.bm25,
                    st.session_state.chat_history
                )

            is_not_found = answer.startswith("NOT FOUND")
            box_class = "not-found-box" if is_not_found else "answer-box"
            st.markdown(f'<div class="{box_class}">{answer}</div>', unsafe_allow_html=True)

            # Self-reflection summary badge
            if reflection_log:
                last = reflection_log[-1]
                faithful_icon = "✓" if last["faithful"] else "✗"
                relevant_icon = "✓" if last["relevant"] else "✗"
                iters = len(reflection_log)
                badge_color = "#00ff9d" if (last["faithful"] and last["relevant"]) else "#ffaa44"
                st.markdown(
                    f'<div style="margin-top:0.5rem; font-family:\'Space Mono\',monospace; font-size:0.7rem; color:{badge_color};">'
                    f'Reflection: {faithful_icon} Faithful · {relevant_icon} Relevant'
                    f'{" · " + str(iters) + " iteration(s)" if iters > 1 else ""}'
                    f'</div>',
                    unsafe_allow_html=True
                )

            with st.expander("📄 Retrieved Chunks"):
                for i, chunk in enumerate(used_chunks):
                    st.markdown(f'<div class="chunk-label">Chunk {i+1}</div><div class="chunk-card">{chunk}</div>', unsafe_allow_html=True)

            with st.expander("🔍 Self-Reflection Log"):
                for entry in reflection_log:
                    st.markdown(
                        f"**Iteration {entry['iteration']}** {'(with query expansion)' if entry['expanded'] else ''}\n"
                        f"- Chunks retrieved: {entry['retrieved']} → after grading: {entry['after_grading']}\n"
                        f"- Faithful: {'✓' if entry['faithful'] else '✗'}  |  "
                        f"Relevant: {'✓' if entry['relevant'] else '✗'}\n"
                        f"- Reason: _{entry['reason']}_"
                    )

        # Update memory
        st.session_state.chat_history.append({"role": "user", "content": prompt})
        st.session_state.chat_history.append({"role": "assistant", "content": answer})
        st.session_state.messages.append({
            "role": "assistant",
            "content": answer,
            "chunks": used_chunks,
            "reflection_log": reflection_log
        })
