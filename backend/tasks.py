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

# Models loaded once when the worker process starts
print("Celery worker: loading models...")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
print("Celery worker: models ready")

_cache = redis.Redis(host="localhost", port=6379, db=0, decode_responses=False)

# ── Text processing (duplicated from main.py to avoid circular imports) ──

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

_CONCAT_SPLIT_RE = re.compile(
    r"([a-z,;'])("
    r"Aortic\s+(?:stenosis|regurgitation)|"
    r"Mitral\s+(?:stenosis|incompetence|prolapse)|"
    r"Pulmonary\s+(?:stenosis|incompetence|hypertension)|"
    r"Tricuspid\s+(?:incompetence|stenosis)|"
    r"Ventricular\s+septal|Atrial\s+septal|Patent\s+ductus|"
    r"Coarctation\s+of|Slow-rising|Collapsing|Alternans|Bisferiens|Paradoxus|"
    r"Pleural\s+effusion|Consolidation|Pneumothorax"
    r")",
)


def restructure_tables(raw_text: str) -> str:
    table_re = re.compile(
        r"([A-Z][^\n]{5,80}\n)"
        r"((?:Lesion|Type|Character|Feature|Sign|Condition|Finding)\s[^\n]+\n)"
        r"((?:[^\n]{15,}\n){3,30})",
        re.IGNORECASE,
    )
    replacements = []
    for match in table_re.finditer(raw_text):
        body = _CONCAT_SPLIT_RE.sub(r"\1\n\2", match.group(3))
        lines = [l.strip() for l in body.split("\n") if l.strip()]
        rows, current = [], ""
        for line in lines:
            first = line.split()[0].lower() if line.split() else ""
            if line[0].isupper() and first not in _ROW_CONTINUATION_STARTERS and len(first) > 2:
                if current:
                    rows.append(current.strip())
                current = line
            else:
                current += " " + line
        if current:
            rows.append(current.strip())
        if rows:
            def _end(r): return r if r.endswith((".", "!", "?")) else r + "."
            tagged = "\n".join(f"TABLE_ROW: {_end(r)}" for r in rows)
            replacements.append((match.start(), match.end(), f". {tagged}\n"))
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
    if chunk.startswith("TABLE_ROW:"):
        return True
    words = chunk.split()
    if len(words) < min_words:
        return False
    if chunk.count("...") > 3 or chunk.count("....") > 2:
        return False
    roman = re.findall(r"\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b", chunk.lower())
    return len(roman) <= 5


def chunk_text(text: str, chunk_size: int = 600, overlap: int = 100) -> list:
    sentences = re.split(r"(?<=[.?!])\s+", text)
    chunks, current_chunk = [], ""
    for sentence in sentences:
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

        text = restructure_tables(text)
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
