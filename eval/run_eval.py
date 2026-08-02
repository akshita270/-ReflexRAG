"""
Ground truth eval harness for ReflexRAG.

Usage:
    python eval/run_eval.py --session_id <id> [--api_url https://reflexrag.com]

It runs each QA pair in ground_truth.json through the /chat endpoint,
then uses GPT-4o-mini as a judge to score each answer 0-2:
  2 = correct and complete
  1 = partially correct / key fact missing
  0 = wrong or hallucinated

Outputs a per-question table and aggregate accuracy to stdout,
and writes results to eval/results_<timestamp>.json.
"""

import argparse
import json
import os
import time
from datetime import datetime
from pathlib import Path

import requests
from openai import OpenAI

GROUND_TRUTH_PATH = Path(__file__).parent / "ground_truth.json"
RESULTS_DIR = Path(__file__).parent

JUDGE_SYSTEM = """You are an expert evaluator for a medical/healthcare RAG system.
You will be given:
- A question about an OECD healthcare report
- A reference answer (ground truth)
- The system's answer

Score the system's answer on a scale of 0-2:
  2 = Correct and sufficiently complete. Key facts match the reference.
  1 = Partially correct. Gets some key facts right but misses important details or adds minor errors.
  0 = Incorrect, hallucinated, or completely off-topic.

Reply with JSON only: {"score": <0|1|2>, "reason": "<one sentence>"}"""

JUDGE_USER = """Question: {question}

Reference answer: {reference}

System answer: {system_answer}

Score:"""


def restore_session(session_id: str, api_url: str):
    resp = requests.post(f"{api_url}/restore/{session_id}", timeout=120)
    if resp.ok:
        print(f"Session restored: {resp.json().get('filename', session_id)}\n")
    else:
        raise SystemExit(f"Could not restore session {session_id}: {resp.text}")


def chat(session_id: str, question: str, api_url: str, bypass_cache: bool = False) -> dict:
    resp = requests.post(
        f"{api_url}/chat",
        json={"session_id": session_id, "query": question, "bypass_cache": bypass_cache},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def judge(question: str, reference: str, system_answer: str, client: OpenAI) -> dict:
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": JUDGE_USER.format(
                question=question,
                reference=reference,
                system_answer=system_answer,
            )},
        ],
        response_format={"type": "json_object"},
        temperature=0,
    )
    return json.loads(resp.choices[0].message.content)


def score_label(score: int) -> str:
    return {2: "CORRECT", 1: "PARTIAL", 0: "WRONG"}.get(score, "?")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session_id", required=True, help="Active RAG session ID with the PDF loaded")
    parser.add_argument("--api_url", default="https://reflexrag.com")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between questions")
    parser.add_argument("--bypass-cache", action="store_true", help="Skip cache and force pipeline on every question")
    args = parser.parse_args()

    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        raise SystemExit("Set OPENAI_API_KEY env var before running.")

    client = OpenAI(api_key=openai_key)
    gt = json.loads(GROUND_TRUTH_PATH.read_text())
    qa_pairs = gt["qa_pairs"]

    results = []
    total_score = 0
    max_score = len(qa_pairs) * 2

    print(f"\n{'='*70}")
    print(f"ReflexRAG Eval  |  {len(qa_pairs)} questions  |  session: {args.session_id}")
    print(f"{'='*70}\n")

    print("Restoring session...")
    restore_session(args.session_id, args.api_url)

    for i, qa in enumerate(qa_pairs, 1):
        qid = qa["id"]
        question = qa["question"]
        reference = qa["answer"]

        print(f"[{i:02d}/{len(qa_pairs)}] {qid} — {question[:60]}...")

        # Query pipeline
        t0 = time.time()
        try:
            resp = chat(args.session_id, question, args.api_url, bypass_cache=args.bypass_cache)
            elapsed = time.time() - t0
            system_answer = resp.get("answer", "")
            faithful = resp.get("faithful")
            relevant = resp.get("relevant")
            ctx_prec = resp.get("context_precision")
            iterations = resp.get("iterations", 1)
            source = resp.get("source", "pipeline")
        except Exception as e:
            print(f"  ERROR querying pipeline: {e}")
            results.append({**qa, "system_answer": "", "score": 0, "reason": str(e), "elapsed": 0})
            continue

        # Judge answer
        try:
            verdict = judge(question, reference, system_answer, client)
            score = verdict["score"]
            reason = verdict["reason"]
        except Exception as e:
            score = 0
            reason = f"Judge error: {e}"

        total_score += score
        label = score_label(score)

        print(f"  Score: {label} ({score}/2) | {reason}")
        print(f"  Faithful={faithful} Relevant={relevant} CtxPrec={ctx_prec} Iters={iterations} Time={elapsed:.1f}s\n")

        results.append({
            **qa,
            "system_answer": system_answer,
            "score": score,
            "label": label,
            "reason": reason,
            "faithful": faithful,
            "relevant": relevant,
            "context_precision": ctx_prec,
            "iterations": iterations,
            "response_time_s": round(elapsed, 2),
            "source": source,
        })

        if i < len(qa_pairs):
            time.sleep(args.delay)

    # Summary
    pct = (total_score / max_score) * 100
    correct = sum(1 for r in results if r["score"] == 2)
    partial = sum(1 for r in results if r["score"] == 1)
    wrong = sum(1 for r in results if r["score"] == 0)

    print(f"\n{'='*70}")
    print(f"RESULTS: {total_score}/{max_score} points ({pct:.1f}%)")
    print(f"  Correct: {correct}  Partial: {partial}  Wrong: {wrong}")
    print(f"{'='*70}")

    # Self-eval vs judge correlation
    pipeline_faithful = [r for r in results if r.get("faithful") is True]
    print(f"\nPipeline self-grade vs judge:")
    print(f"  Pipeline said faithful=True on {len(pipeline_faithful)}/{len(results)} answers")
    faithful_correct = sum(1 for r in pipeline_faithful if r["score"] == 2)
    print(f"  Of those, judge scored CORRECT: {faithful_correct}/{len(pipeline_faithful)}")

    # Wrong answers
    wrong_qa = [r for r in results if r["score"] == 0]
    if wrong_qa:
        print(f"\nWRONG answers ({len(wrong_qa)}):")
        for r in wrong_qa:
            print(f"  {r['id']}: {r['question'][:60]}...")
            print(f"    Reason: {r['reason']}")

    # Save results
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = RESULTS_DIR / f"results_{ts}.json"
    out_path.write_text(json.dumps({
        "session_id": args.session_id,
        "api_url": args.api_url,
        "timestamp": ts,
        "total_score": total_score,
        "max_score": max_score,
        "accuracy_pct": round(pct, 1),
        "correct": correct,
        "partial": partial,
        "wrong": wrong,
        "results": results,
    }, indent=2))
    print(f"\nResults saved to: {out_path}")


if __name__ == "__main__":
    main()
