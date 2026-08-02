import os, json, re
import numpy as np
import faiss
import redis
import boto3
from io import BytesIO
from pypdf import PdfReader
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

from celery_app import celery_app

load_dotenv()

print("Celery worker: loading models...")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
print("Celery worker: models ready")

_cache = redis.Redis(host="localhost", port=6379, db=0, decode_responses=False)


def clean_text(text: str) -> str:
    text = re.sub(r"(\w+)-\s*\n\s*(\w+)", r"\1\2", text)
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"(?m)^\s*\d{1,3}\s*$", "", text)
    return text.strip()


def is_valid_chunk(chunk: str, min_words: int = 20) -> bool:
    words = chunk.split()
    if len(words) < min_words:
        return False
    if chunk.count("..") > 4:
        return False
    alpha_ratio = sum(c.isalpha() for c in chunk) / max(len(chunk), 1)
    return alpha_ratio >= 0.4


def chunk_text(text: str, chunk_size: int = 750, overlap: int = 150) -> list:
    paragraphs = re.split(r"\n{2,}", text)
    chunks: list = []
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
                overlap_text = current[-overlap:] if len(current) > overlap else current
                current = overlap_text + "\n\n" + para
            else:
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


# ── Celery task ──

@celery_app.task(bind=True)
def process_pdf(self, session_id: str, s3_key: str, filename: str):
    try:
        self.update_state(state="PROGRESS", meta={"status": "Downloading PDF from S3..."})

        s3_client = boto3.client("s3", region_name="us-east-1")
        obj = s3_client.get_object(Bucket=os.getenv("S3_BUCKET", "reflexrag-pdfs"), Key=s3_key)
        content = obj["Body"].read()

        self.update_state(state="PROGRESS", meta={"status": "Extracting and chunking text..."})

        reader = PdfReader(BytesIO(content))
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"

        chunks = chunk_text(clean_text(text))
        if not chunks:
            raise ValueError("No valid text chunks found in PDF.")

        self.update_state(state="PROGRESS", meta={"status": f"Building index for {len(chunks)} chunks..."})

        embeddings = embed_model.encode(chunks, show_progress_bar=False)
        idx = faiss.IndexFlatL2(embeddings.shape[1])
        idx.add(np.array(embeddings, dtype=np.float32))

        # Serialize FAISS index and store in Redis (24h TTL)
        index_bytes = faiss.serialize_index(idx).tobytes()
        _cache.set(f"session_index:{session_id}", index_bytes, ex=86400)
        _cache.set(
            f"session_chunks:{session_id}",
            json.dumps(chunks).encode(),
            ex=86400,
        )

        print(f"Task done: {session_id} ({len(chunks)} chunks)")
        return {"session_id": session_id, "chunk_count": len(chunks), "filename": filename}

    except Exception as exc:
        self.update_state(state="FAILURE", meta={"status": str(exc)})
        raise
