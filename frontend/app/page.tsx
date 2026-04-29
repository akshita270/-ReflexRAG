"use client";

import { useState, useRef, useEffect } from "react";
import { uploadPDF, sendChat, resetSession } from "@/lib/api";
import type { Message, ReflectionEntry } from "@/lib/types";

const PIPELINE_STEPS = [
  { label: "PDF Load & Clean",       icon: "◈", reflect: false },
  { label: "Sentence Chunking",      icon: "◉", reflect: false },
  { label: "FAISS + BM25 Index",     icon: "◎", reflect: false },
  { label: "Hybrid Search (RRF)",    icon: "◈", reflect: false },
  { label: "MMR Diversity",          icon: "◉", reflect: false },
  { label: "Cross-Encoder Rerank",   icon: "◎", reflect: false },
  { label: "Retrieval Grading",      icon: "✦", reflect: true  },
  { label: "GPT-4o mini",            icon: "◈", reflect: false },
  { label: "Answer Grading",         icon: "✦", reflect: true  },
];

// ── REFLECTION BADGE ─────────────────────────────────────────
function ReflectionBadge({ log }: { log: ReflectionEntry[] }) {
  if (!log.length) return null;
  const last = log[log.length - 1];
  const ok = last.faithful && last.relevant;
  return (
    <div className="flex items-center gap-2 mt-2">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono"
        style={{
          background: ok ? "rgba(0,214,143,0.08)" : "rgba(251,113,133,0.08)",
          border: `1px solid ${ok ? "rgba(0,214,143,0.25)" : "rgba(251,113,133,0.25)"}`,
          color: ok ? "#00d68f" : "#fb7185",
        }}
      >
        ●&nbsp;
        {last.faithful ? "Faithful" : "Not Faithful"} ·{" "}
        {last.relevant ? "Relevant" : "Not Relevant"}
        {log.length > 1 ? ` · ${log.length} iterations` : ""}
      </span>
    </div>
  );
}

// ── REFLECTION LOG ────────────────────────────────────────────
function ReflectionLog({ log }: { log: ReflectionEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!log.length) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-mono transition-colors flex items-center gap-1"
        style={{ color: "#64748b" }}
      >
        <span style={{ fontSize: "0.6rem" }}>{open ? "▲" : "▼"}</span>
        Self-Reflection Log
      </button>
      {open && (
        <div
          className="mt-2 rounded-xl p-3 text-xs space-y-3"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {log.map((entry) => (
            <div key={entry.iteration} className="space-y-1">
              <p className="font-mono font-semibold" style={{ color: "#00d68f" }}>
                Iteration {entry.iteration}
                {entry.expanded ? (
                  <span style={{ color: "#7c3aed", fontWeight: 400 }}> · query expanded</span>
                ) : ""}
              </p>
              <p style={{ color: "#94a3b8" }}>
                {entry.retrieved} chunks retrieved → {entry.after_grading} passed grading
              </p>
              <div className="flex gap-3">
                <span style={{ color: entry.faithful ? "#00d68f" : "#fb7185" }}>
                  {entry.faithful ? "✓" : "✗"} Faithful
                </span>
                <span style={{ color: entry.relevant ? "#00d68f" : "#fb7185" }}>
                  {entry.relevant ? "✓" : "✗"} Relevant
                </span>
              </div>
              {entry.reason && (
                <p style={{ color: "#475569", fontStyle: "italic" }}>{entry.reason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CHUNK VIEWER ──────────────────────────────────────────────
function ChunkViewer({ chunks }: { chunks: string[] }) {
  const [open, setOpen] = useState(false);
  if (!chunks.length) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-mono transition-colors flex items-center gap-1"
        style={{ color: "#64748b" }}
      >
        <span style={{ fontSize: "0.6rem" }}>{open ? "▲" : "▼"}</span>
        Retrieved Chunks ({chunks.length})
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {chunks.map((chunk, i) => (
            <div
              key={i}
              className="rounded-xl p-3 text-xs leading-relaxed"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderLeft: "2px solid rgba(0,214,143,0.4)",
                color: "#94a3b8",
              }}
            >
              <p
                className="font-mono mb-1.5 uppercase tracking-widest"
                style={{ fontSize: "0.6rem", color: "#00d68f", opacity: 0.7 }}
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

// ── CHAT BUBBLE ───────────────────────────────────────────────
function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const isNotFound = msg.content.startsWith("NOT FOUND");

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-lg rounded-2xl px-4 py-3 text-sm leading-relaxed"
          style={{
            background: "rgba(124,58,237,0.12)",
            border: "1px solid rgba(124,58,237,0.2)",
            color: "#e2e8f0",
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-2xl w-full">
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold mt-0.5"
            style={{
              background: isNotFound ? "rgba(251,113,133,0.12)" : "rgba(0,214,143,0.12)",
              border: `1px solid ${isNotFound ? "rgba(251,113,133,0.2)" : "rgba(0,214,143,0.2)"}`,
              color: isNotFound ? "#fb7185" : "#00d68f",
            }}
          >
            ◈
          </div>
          <div className="flex-1">
            <div
              className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
              style={{
                background: isNotFound ? "rgba(251,113,133,0.05)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isNotFound ? "rgba(251,113,133,0.15)" : "rgba(255,255,255,0.07)"}`,
                color: isNotFound ? "#fca5a5" : "#e2e8f0",
              }}
            >
              {msg.content}
            </div>
            {msg.reflection_log && <ReflectionBadge log={msg.reflection_log} />}
            {msg.chunks && <ChunkViewer chunks={msg.chunks} />}
            {msg.reflection_log && <ReflectionLog log={msg.reflection_log} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TYPING INDICATOR ──────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
          style={{
            background: "rgba(0,214,143,0.12)",
            border: "1px solid rgba(0,214,143,0.2)",
            color: "#00d68f",
          }}
        >
          ◈
        </div>
        <div
          className="rounded-2xl px-4 py-3 text-sm font-mono flex items-center gap-2"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "#475569",
          }}
        >
          <span className="animate-pulse">Searching</span>
          <span style={{ color: "rgba(0,214,143,0.4)" }}>·</span>
          <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>Reflecting</span>
          <span style={{ color: "rgba(0,214,143,0.4)" }}>·</span>
          <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>Generating</span>
        </div>
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────
export default function Home() {
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [filename, setFilename]     = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [uploading, setUploading]   = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

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
    setSessionId(null);
    setFilename(null);
    setChunkCount(0);
    setMessages([]);
  }

  const canSend = !!sessionId && !!input.trim() && !loading;

  return (
    <div
      className="flex h-dvh overflow-hidden"
      style={{ background: "#050508", fontFamily: "'Inter', 'DM Sans', sans-serif" }}
    >
      {/* ── SIDEBAR ── */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.015)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Logo */}
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
              style={{
                background: "rgba(0,214,143,0.12)",
                border: "1px solid rgba(0,214,143,0.2)",
              }}
            >
              🧠
            </div>
            <span className="font-bold text-lg tracking-tight" style={{ color: "#f1f5f9" }}>
              ReflexRAG
            </span>
          </div>
          <p className="text-xs ml-10" style={{ color: "#475569" }}>
            Clinical PDF Assistant
          </p>
        </div>

        <div className="px-4 pb-4">
          <div style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />
        </div>

        {/* Upload */}
        <div className="px-4 pb-4">
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-2"
            style={{ color: "#475569", letterSpacing: "0.08em" }}
          >
            Document
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-xl py-2.5 px-3 text-xs font-medium transition-all flex items-center justify-center gap-2"
            style={{
              background: uploading ? "rgba(0,214,143,0.05)" : "rgba(0,214,143,0.08)",
              border: "1px solid rgba(0,214,143,0.2)",
              color: "#00d68f",
              cursor: uploading ? "wait" : "pointer",
            }}
          >
            {uploading ? (
              <><span className="animate-spin">◎</span> Processing...</>
            ) : (
              <><span>↑</span> Upload PDF</>
            )}
          </button>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
          {filename && (
            <div
              className="mt-2 rounded-lg px-3 py-2 text-xs"
              style={{
                background: "rgba(0,214,143,0.05)",
                border: "1px solid rgba(0,214,143,0.1)",
              }}
            >
              <p className="truncate font-medium" style={{ color: "#94a3b8" }}>{filename}</p>
              <p style={{ color: "#475569" }}>{chunkCount} chunks indexed</p>
            </div>
          )}
        </div>

        <div className="px-4 pb-4">
          <div style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />
        </div>

        {/* Pipeline */}
        <div className="px-4 flex-1 overflow-y-auto">
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: "#475569", letterSpacing: "0.08em" }}
          >
            Pipeline
          </p>
          <div className="space-y-0.5">
            {PIPELINE_STEPS.map((step) => {
              const active = !!sessionId;
              const isReflect = step.reflect;
              return (
                <div
                  key={step.label}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all"
                  style={{
                    color: active ? (isReflect ? "#00d68f" : "#94a3b8") : "#2d3748",
                    background: active && isReflect ? "rgba(0,214,143,0.05)" : "transparent",
                  }}
                >
                  <span style={{ fontSize: "0.55rem", opacity: active ? 1 : 0.4 }}>
                    {step.icon}
                  </span>
                  <span className={isReflect ? "font-medium" : ""}>{step.label}</span>
                  {isReflect && (
                    <span className="ml-auto" style={{ color: "rgba(0,214,143,0.5)", fontSize: "0.55rem" }}>
                      ✦
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs mt-3" style={{ color: "#2d3748" }}>
            ✦ Self-Reflection nodes
          </p>
        </div>

        {/* Reset */}
        {sessionId && (
          <div className="px-4 pb-5 pt-2">
            <div className="mb-3" style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />
            <button
              onClick={handleReset}
              className="w-full rounded-xl py-2 px-3 text-xs font-medium transition-all"
              style={{
                background: "rgba(251,113,133,0.06)",
                border: "1px solid rgba(251,113,133,0.15)",
                color: "#fb7185",
              }}
            >
              Reset Session
            </button>
          </div>
        )}
      </aside>

      {/* ── MAIN ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-8 py-4 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div>
            <h2 className="font-semibold text-base" style={{ color: "#f1f5f9" }}>
              Clinical Research Assistant
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
              Hybrid Search · MMR · Reranking · Self-Reflection RAG
            </p>
          </div>
          {sessionId && (
            <div
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
              style={{
                background: "rgba(0,214,143,0.08)",
                border: "1px solid rgba(0,214,143,0.2)",
                color: "#00d68f",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#00d68f" }} />
              Ready
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {!sessionId && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-sm">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
                  style={{
                    background: "rgba(0,214,143,0.08)",
                    border: "1px solid rgba(0,214,143,0.15)",
                  }}
                >
                  🧠
                </div>
                <h3 className="font-semibold text-base mb-2" style={{ color: "#94a3b8" }}>
                  Upload a PDF to get started
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: "#475569" }}>
                  Ask questions about clinical research papers using hybrid
                  retrieval with self-reflection grading.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble key={i} msg={msg} />
          ))}

          {loading && <TypingIndicator />}

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-xs"
              style={{
                background: "rgba(251,113,133,0.06)",
                border: "1px solid rgba(251,113,133,0.15)",
                color: "#fca5a5",
              }}
            >
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div
          className="px-8 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div
            className="flex gap-2 rounded-2xl px-4 py-3 items-center"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${canSend ? "rgba(0,214,143,0.2)" : "rgba(255,255,255,0.07)"}`,
              transition: "border-color 0.2s",
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={sessionId ? "Ask anything about the document..." : "Upload a PDF first"}
              disabled={!sessionId || loading}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "#e2e8f0", caretColor: "#00d68f" }}
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="rounded-xl px-4 py-2 text-xs font-semibold transition-all flex-shrink-0"
              style={{
                background: canSend ? "rgba(0,214,143,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${canSend ? "rgba(0,214,143,0.3)" : "rgba(255,255,255,0.07)"}`,
                color: canSend ? "#00d68f" : "#334155",
                cursor: canSend ? "pointer" : "not-allowed",
                transition: "all 0.2s",
              }}
            >
              Send ↵
            </button>
          </div>
          <p className="text-center text-xs mt-2" style={{ color: "#1e293b" }}>
            Answers grounded in document context only
          </p>
        </div>
      </main>
    </div>
  );
}
