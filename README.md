# 🧠 ReflexRAG — Clinical PDF Research Assistant

A production-grade Retrieval-Augmented Generation (RAG) system for clinical research PDFs, featuring hybrid retrieval, cross-encoder reranking, and a Self-Reflection grading loop that validates answers before returning them.

**Live Demo → [reflexrag.netlify.app](https://reflexrag.netlify.app)**

---

## ✨ Features

- **Hybrid Retrieval** — FAISS semantic search + BM25 keyword search fused with Reciprocal Rank Fusion (RRF)
- **MMR Diversity** — Maximal Marginal Relevance filtering to eliminate redundant chunks
- **Cross-Encoder Reranking** — Re-scores retrieved chunks for precision
- **Self-Reflection RAG** — Dual LLM grading loops verify retrieval quality and answer faithfulness, retrying with query expansion on failure
- **Rule-based Table Parsing** — Accurately parses clinical tables (e.g. cardiac murmur characteristics) into isolated chunks
- **Session Management** — UUID-based sessions with in-memory FAISS index per upload

---

## 🏗️ Architecture

```
PDF Upload
    │
    ▼
┌─────────────────────────────────────────┐
│           9-Stage Pipeline              │
│                                         │
│  01  PDF Load & Clean                   │
│  02  Sentence Chunking                  │
│  03  FAISS + BM25 Index                 │
│  04  Hybrid Search (RRF)                │
│  05  MMR Diversity Filtering            │
│  06  Cross-Encoder Reranking            │
│  07  Retrieval Grading ✦               │
│  08  GPT-4o mini Generation             │
│  09  Answer Grading ✦                  │
│                                         │
│  ✦ Self-Reflection nodes               │
└─────────────────────────────────────────┘
    │
    ▼
Validated Answer
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, Uvicorn |
| Embeddings | `sentence-transformers` (all-MiniLM-L6-v2) |
| Reranking | `cross-encoder/ms-marco-MiniLM-L-6-v2` |
| Vector Search | FAISS |
| Keyword Search | BM25 (rank-bm25) |
| LLM | OpenAI GPT-4o mini |
| PDF Parsing | pypdf |
| Frontend | Next.js 15, TypeScript, Tailwind CSS |
| Deployment | AWS EC2 t3.micro, nginx, Let's Encrypt, Netlify |

---

## 🚀 Local Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env file
echo 'OPENAI_API_KEY=your_key_here' > .env

uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install

# Create .env.local
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > .env.local

npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📁 Project Structure

```
ReflexRAG/
├── backend/
│   ├── main.py          # FastAPI app — full RAG pipeline
│   ├── requirements.txt
│   └── .env             # OPENAI_API_KEY (not committed)
├── frontend/
│   ├── app/
│   │   └── page.tsx     # Main UI
│   ├── lib/
│   │   ├── api.ts       # API client
│   │   └── types.ts     # TypeScript interfaces
│   └── netlify.toml
└── render.yaml
```

---

## 🌐 Deployment

| Service | Platform |
|---------|----------|
| Frontend | Netlify |
| Backend | AWS EC2 t3.micro |
| SSL | Let's Encrypt (Certbot) |
| Domain | DuckDNS |

---

## 📄 License

MIT
