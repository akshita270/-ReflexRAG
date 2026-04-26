"use client";

import { useState, useRef, useEffect } from "react";
import { uploadPDF, sendChat, resetSession } from "@/lib/api";
import type { Message, ReflectionEntry } from "@/lib/types";

// ── PIPELINE STEPS ────────────────────────────────────────────
const PIPELINE_STEPS = [
  { label: "PDF Load & Clean", reflect: false },
  { label: "Sentence Chunking", reflect: false },
  { label: "FAISS + BM25 Index", reflect: false },
  { label: "Hybrid Search (RRF)", reflect: false },
  { label: "MMR Diversity", reflect: false },
  { label: "Cross-Encoder Rerank", reflect: false },
  { label: "Retrieval Grading", reflect: true },
  { label: "Groq LLaMA 3.3 70B", reflect: false },
  { label: "Answer Grading", reflect: true },
];

// ── SUB-COMPONENTS ────────────────────────────────────────────

function ReflectionBadge({ log }: { log: ReflectionEntry[] }) {
  if (!log.length) return null;
  const last = log[log.length - 1];
  const ok = last.faithful && last.relevant;
  return (
    <div
      className="mt-2 font-mono text-xs"
      style={{ color: ok ? "#00ff9d" : "#ffaa44" }}
    >
      Reflection: {last.faithful ? "✓" : "✗"} Faithful ·{" "}
      {last.relevant ? "✓" : "✗"} Relevant
      {log.length > 1 ? ` · ${log.length} iterations` : ""}
    </div>
  );
}

function ReflectionLog({ log }: { log: ReflectionEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!log.length) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-mono text-muted hover:text-accent transition-colors"
        style={{ color: "#888899" }}
      >
        {open ? "▲" : "▼"} Self-Reflection Log
      </button>
      {open && (
        <div
          className="mt-2 rounded-lg p-3 text-xs space-y-3"
          style={{ background: "#0d0d18", border: "1px solid #2a2a3f" }}
        >
          {log.map((entry) => (
            <div key={entry.iteration}>
              <p className="font-mono" style={{ color: "#00ff9d" }}>
                Iteration {entry.iteration}
                {entry.expanded ? " (query expanded)" : ""}
              </p>
              <p style={{ color: "#b0b0c8" }}>
                Chunks: {entry.retrieved} retrieved → {entry.after_grading} after grading
              </p>
              <p style={{ color: "#b0b0c8" }}>
                Faithful: {entry.faithful ? "✓" : "✗"} &nbsp;|&nbsp; Relevant:{" "}
                {entry.relevant ? "✓" : "✗"}
              </p>
              {entry.reason && (
                <p style={{ color: "#666680", fontStyle: "italic" }}>{entry.reason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChunkViewer({ chunks }: { chunks: string[] }) {
  const [open, setOpen] = useState(false);
  if (!chunks.length) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-mono transition-colors"
        style={{ color: "#888899" }}
      >
        {open ? "▲" : "▼"} Retrieved Chunks ({chunks.length})
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {chunks.map((chunk, i) => (
            <div
              key={i}
              className="rounded-lg p-3 text-xs leading-relaxed"
              style={{
                background: "#12121f",
                border: "1px solid #2a2a3f",
                borderLeft: "3px solid #00ff9d",
                color: "#b0b0c8",
              }}
            >
              <p
                className="font-mono mb-1 uppercase tracking-widest"
                style={{ fontSize: "0.65rem", color: "#00ff9d" }}
              >
                Chunk {i + 1}
              </p>
              {chunk}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const isNotFound = msg.content.startsWith("NOT FOUND");

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-xl rounded-2xl px-4 py-3 text-sm"
          style={{ background: "#1a1a2f", border: "1px solid #2a2a3f", color: "#e8e8f0" }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-2xl w-full">
        <div
          className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
          style={{
            background: isNotFound ? "#1f0d0d" : "#0d1f17",
            border: `1px solid ${isNotFound ? "#ff4d4d44" : "#00ff9d44"}`,
            color: isNotFound ? "#ffaaaa" : "#e8e8f0",
          }}
        >
          {msg.content}
        </div>
        {msg.reflection_log && <ReflectionBadge log={msg.reflection_log} />}
        {msg.chunks && <ChunkViewer chunks={msg.chunks} />}
        {msg.reflection_log && <ReflectionLog log={msg.reflection_log} />}
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadPDF(file);
      setSessionId(res.session_id);
      setFilename(res.filename);
      setChunkCount(res.chunk_count);
      setMessages([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSend() {
    const query = input.trim();
    if (!query || !sessionId || loading) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setLoading(true);
    try {
      const res = await sendChat(sessionId, query);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          chunks: res.chunks,
          reflection_log: res.reflection_log,
        },
      ]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (sessionId) await resetSession(sessionId);
    setMessages([]);
  }

  return (
    <div className="flex h-dvh" style={{ background: "#0a0a0f" }}>
      {/* ── SIDEBAR ── */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col p-5 gap-5 overflow-y-auto"
        style={{ background: "#0d0d18", borderRight: "1px solid #2a2a3f" }}
      >
        {/* Logo */}
        <div>
          <h1 className="font-mono text-2xl font-bold" style={{ color: "#00ff9d" }}>
            🧠 RAG
          </h1>
          <p className="text-xs mt-1" style={{ color: "#888899" }}>
            Clinical PDF Assistant
          </p>
        </div>

        {/* Upload */}
        <div>
          <p className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "#00ff9d" }}>
            Upload PDF
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-lg py-2 px-3 text-xs font-mono transition-all"
            style={{
              background: "#00ff9d11",
              border: "1px dashed #00ff9d44",
              color: "#00ff9d",
              cursor: uploading ? "wait" : "pointer",
            }}
          >
            {uploading ? "Processing..." : "Choose PDF"}
          </button>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
          {filename && (
            <p className="text-xs mt-2 truncate" style={{ color: "#888899" }}>
              {filename} · {chunkCount} chunks
            </p>
          )}
        </div>

        <hr style={{ borderColor: "#2a2a3f" }} />

        {/* Pipeline */}
        <div>
          <p className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "#00ff9d" }}>
            Pipeline
          </p>
          <div className="space-y-1">
            {PIPELINE_STEPS.map((step) => (
              <div
                key={step.label}
                className="text-xs font-mono"
                style={{ color: sessionId ? (step.reflect ? "#00ff9d" : "#888899") : "#333350" }}
              >
                → {step.label}
                {step.reflect && (
                  <span className="ml-1 text-xs" style={{ color: "#00ff9d88" }}>
                    ✦
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: "#333350" }}>
            ✦ Self-Reflection
          </p>
        </div>

        <hr style={{ borderColor: "#2a2a3f" }} />

        {/* Reset */}
        {sessionId && (
          <button
            onClick={handleReset}
            className="w-full rounded-lg py-2 px-3 text-xs font-mono transition-all"
            style={{
              background: "#00ff9d11",
              border: "1px solid #00ff9d44",
              color: "#00ff9d",
            }}
          >
            Reset Chat
          </button>
        )}
      </aside>

      {/* ── MAIN AREA ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-8 py-5" style={{ borderBottom: "1px solid #2a2a3f" }}>
          <h2 className="font-mono text-xl font-bold" style={{ color: "#00ff9d" }}>
            Clinical Research Assistant
          </h2>
          <p className="text-xs mt-1" style={{ color: "#888899" }}>
            Hybrid Search · MMR · Reranking · Self-Reflection RAG
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
          {!sessionId && (
            <div
              className="rounded-xl p-6 text-sm text-center"
              style={{ background: "#12121f", border: "1px solid #2a2a3f", color: "#888899" }}
            >
              Upload a clinical PDF from the sidebar to get started.
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble key={i} msg={msg} />
          ))}

          {loading && (
            <div className="flex justify-start">
              <div
                className="rounded-2xl px-4 py-3 text-sm font-mono"
                style={{ background: "#0d1f17", border: "1px solid #00ff9d22", color: "#00ff9d88" }}
              >
                Searching · Reflecting · Generating...
              </div>
            </div>
          )}

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm"
              style={{ background: "#1f0d0d", border: "1px solid #ff4d4d44", color: "#ffaaaa" }}
            >
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-8 py-4" style={{ borderTop: "1px solid #2a2a3f" }}>
          <div className="flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={sessionId ? "Ask anything about the PDF..." : "Upload a PDF first"}
              disabled={!sessionId || loading}
              className="flex-1 rounded-xl px-4 py-3 text-sm outline-none transition-all"
              style={{
                background: "#12121f",
                border: "1px solid #2a2a3f",
                color: "#e8e8f0",
                caretColor: "#00ff9d",
              }}
            />
            <button
              onClick={handleSend}
              disabled={!sessionId || loading || !input.trim()}
              className="rounded-xl px-5 py-3 text-sm font-mono font-bold transition-all"
              style={{
                background: sessionId && input.trim() ? "#00ff9d22" : "#12121f",
                border: "1px solid #00ff9d44",
                color: sessionId && input.trim() ? "#00ff9d" : "#333350",
                cursor: sessionId && input.trim() ? "pointer" : "not-allowed",
              }}
            >
              Send
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
