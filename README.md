# ReflexRAG

A self-correcting RAG (Retrieval-Augmented Generation) pipeline that reflects on retrieval quality before generating an answer — reducing hallucinations and improving response accuracy.

## How it works

1. Query is sent to the retriever
2. Retrieved chunks are evaluated for relevance
3. If quality is low, the pipeline self-corrects and re-retrieves
4. Final answer is generated only from high-quality context

## Tech Stack

![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)

## Getting Started

```bash
git clone https://github.com/akshita270/-ReflexRAG
cd -ReflexRAG
pip install -r requirements.txt
python main.py
```

## Why ReflexRAG?

Standard RAG pipelines blindly use whatever is retrieved. ReflexRAG adds a reflection step — if the retrieved context isn't good enough, it tries again before answering.
