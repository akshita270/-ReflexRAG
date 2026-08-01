"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { uploadPDF, sendChat, resetSession, fetchSessions, restoreSession } from "@/lib/api";
import type { Message, ReflectionEntry } from "@/lib/types";

type PastSession = { session_id: string; filename: string; chunk_count: number; created_at: string };

const PIPELINE_STEPS = [
  { label: "PDF Load & Clean",      icon: "01", reflect: false },
  { label: "Sentence Chunking",     icon: "02", reflect: false },
  { label: "FAISS + BM25 Index",    icon: "03", reflect: false },
  { label: "Hybrid Search (RRF)",   icon: "04", reflect: false },
  { label: "MMR Diversity",         icon: "05", reflect: false },
  { label: "Cross-Encoder Rerank",  icon: "06", reflect: false },
  { label: "Retrieval Grading",     icon: "07", reflect: true  },
  { label: "GPT-4o mini",           icon: "08", reflect: false },
  { label: "Answer Grading",        icon: "09", reflect: true  },
];

function ReflectionBadge({ log }: { log: ReflectionEntry[] }) {
  if (!log.length) return null;
  const last = log[log.length - 1];
  const ok = last.faithful && last.relevant;
  return (
    <div className="flex items-center gap-2 mt-2">
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
        style={{
          background: ok ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`,
          color: ok ? "#15803d" : "#dc2626",
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: ok ? "#22c55e" : "#ef4444" }}
        />
        {last.faithful ? "Faithful" : "Not Faithful"} ·{" "}
        {last.relevant ? "Relevant" : "Not Relevant"}
        {log.length > 1 ? ` · ${log.length} iterations` : ""}
      </span>
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
        className="text-xs flex items-center gap-1 transition-colors"
        style={{ color: "#94a3b8" }}
      >
        <span style={{ fontSize: "0.5rem" }}>{open ? "▲" : "▼"}</span>
        Self-Reflection Log
      </button>
      {open && (
        <div
          className="mt-2 rounded-xl p-4 text-xs space-y-3"
          style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}
        >
          {log.map((entry) => (
            <div key={entry.iteration} className="space-y-1">
              <p className="font-semibold" style={{ color: "#0f172a" }}>
                Iteration {entry.iteration}
                {entry.expanded && (
                  <span style={{ color: "#7c3aed", fontWeight: 400 }}> · query expanded</span>
                )}
              </p>
              <p style={{ color: "#64748b" }}>
                {entry.retrieved} chunks retrieved → {entry.after_grading} passed grading
              </p>
              <div className="flex gap-4">
                <span style={{ color: entry.faithful ? "#15803d" : "#dc2626" }}>
                  {entry.faithful ? "✓" : "✗"} Faithful
                </span>
                <span style={{ color: entry.relevant ? "#15803d" : "#dc2626" }}>
                  {entry.relevant ? "✓" : "✗"} Relevant
                </span>
              </div>
              {entry.reason && (
                <p style={{ color: "#94a3b8", fontStyle: "italic" }}>{entry.reason}</p>
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
        className="text-xs flex items-center gap-1 transition-colors"
        style={{ color: "#94a3b8" }}
      >
        <span style={{ fontSize: "0.5rem" }}>{open ? "▲" : "▼"}</span>
        Retrieved Chunks ({chunks.length})
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {chunks.map((chunk, i) => (
            <div
              key={i}
              className="rounded-xl p-3 text-xs leading-relaxed"
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderLeft: "3px solid #0d9488",
                color: "#374151",
              }}
            >
              <p
                className="font-semibold mb-1 uppercase tracking-wider"
                style={{ fontSize: "0.6rem", color: "#0d9488" }}
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
          className="max-w-lg rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed"
          style={{
            background: "#0d9488",
            color: "#ffffff",
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-3">
      <div
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm mt-0.5"
        style={{
          background: isNotFound ? "#fef2f2" : "#f0fdfa",
          border: `1px solid ${isNotFound ? "#fecaca" : "#99f6e4"}`,
        }}
      >
        🧠
      </div>
      <div className="flex-1 max-w-2xl">
        <div
          className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed"
          style={{
            background: isNotFound ? "#fef2f2" : "#ffffff",
            border: `1px solid ${isNotFound ? "#fecaca" : "#e2e8f0"}`,
            color: isNotFound ? "#dc2626" : "#1e293b",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
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

function TypingIndicator() {
  return (
    <div className="flex justify-start gap-3">
      <div
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm"
        style={{ background: "#f0fdfa", border: "1px solid #99f6e4" }}
      >
        🧠
      </div>
      <div
        className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm flex items-center gap-2"
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          color: "#94a3b8",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <span className="animate-pulse">Searching</span>
        <span style={{ color: "#cbd5e1" }}>·</span>
        <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>Reflecting</span>
        <span style={{ color: "#cbd5e1" }}>·</span>
        <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>Generating</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [filename, setFilename]     = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [uploading, setUploading]   = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [loading, setLoading]       = useState(false);
  const [restoring, setRestoring]   = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    fetchSessions().then(setPastSessions);
  }, []);

  async function handleRestore(s: PastSession) {
    setRestoring(true);
    setError(null);
    try {
      const res = await restoreSession(s.session_id);
      setSessionId(res.session_id);
      setFilename(res.filename);
      setChunkCount(res.chunk_count);
      setMessages([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadStatus("Uploading to S3...");
    setError(null);
    try {
      const res = await uploadPDF(file, setUploadStatus);
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
      style={{ background: "#f1f5f9", fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── SIDEBAR ── */}
      <aside
        className="w-72 flex-shrink-0 flex flex-col overflow-hidden"
        style={{
          background: "#ffffff",
          borderRight: "1px solid #e2e8f0",
        }}
      >
        {/* Logo */}
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
              style={{ background: "#f0fdfa", border: "1px solid #99f6e4" }}
            >
              🧠
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: "#0f172a" }}>
                ReflexRAG
              </p>
              <p className="text-xs" style={{ color: "#94a3b8" }}>
                Clinical PDF Assistant
              </p>
            </div>
          </div>
        </div>

        <div className="px-6">
          <div style={{ height: "1px", background: "#f1f5f9" }} />
        </div>

        {/* Upload */}
        <div className="px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#475569" }}>
            Document
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-xl py-2.5 px-4 text-sm font-medium transition-all flex items-center justify-center gap-2"
            style={{
              background: uploading ? "#f0fdfa" : "#0d9488",
              color: uploading ? "#0d9488" : "#ffffff",
              cursor: uploading ? "wait" : "pointer",
              boxShadow: uploading ? "none" : "0 1px 3px rgba(13,148,136,0.3)",
            }}
          >
            {uploading ? (
              <><span className="animate-spin">⟳</span> {uploadStatus || "Processing..."}</>
            ) : (
              <>↑ Upload PDF</>
            )}
          </button>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />

          {filename && (
            <div
              className="mt-3 rounded-xl p-3"
              style={{ background: "#f0fdfa", border: "1px solid #99f6e4" }}
            >
              <div className="flex items-start gap-2">
                <span className="text-sm mt-0.5">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "#0f172a" }}>
                    {filename}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "#0d9488" }}>
                    {chunkCount} chunks indexed
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6">
          <div style={{ height: "1px", background: "#f1f5f9" }} />
        </div>

        {/* Past Sessions */}
        {pastSessions.length > 0 && (
          <>
            <div className="px-6">
              <div style={{ height: "1px", background: "#f1f5f9" }} />
            </div>
            <div className="px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#475569" }}>
                Recent Documents
              </p>
              <div className="space-y-1">
                {pastSessions.slice(0, 5).map((s) => (
                  <button
                    key={s.session_id}
                    onClick={() => handleRestore(s)}
                    disabled={restoring || s.session_id === sessionId}
                    className="w-full text-left rounded-xl px-3 py-2 text-xs transition-all flex items-center gap-2"
                    style={{
                      background: s.session_id === sessionId ? "#f0fdfa" : "transparent",
                      border: s.session_id === sessionId ? "1px solid #99f6e4" : "1px solid transparent",
                      color: "#1e293b",
                      cursor: restoring ? "wait" : "pointer",
                    }}
                  >
                    <span>📄</span>
                    <span className="truncate flex-1">{s.filename}</span>
                    {s.session_id === sessionId && (
                      <span style={{ color: "#0d9488", fontSize: "0.6rem" }}>●</span>
                    )}
                  </button>
                ))}
              </div>
              {restoring && (
                <p className="text-xs mt-2 text-center" style={{ color: "#0d9488" }}>
                  Rebuilding index from S3...
                </p>
              )}
            </div>
          </>
        )}

        {/* Pipeline */}
        <div className="px-6 py-5 flex-1 overflow-y-auto">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#475569" }}>
            Pipeline
          </p>
          <div className="space-y-1">
            {PIPELINE_STEPS.map((step) => {
              const active = !!sessionId;
              return (
                <div
                  key={step.label}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-all"
                  style={{
                    background: step.reflect ? "#f0fdfa" : "transparent",
                    color: step.reflect ? "#0d9488" : "#1e293b",
                  }}
                >
                  <span
                    className="font-mono flex-shrink-0"
                    style={{
                      color: step.reflect ? "#0d9488" : "#64748b",
                      fontSize: "0.6rem",
                    }}
                  >
                    {step.icon}
                  </span>
                  <span className={step.reflect ? "font-semibold" : "font-medium"}>{step.label}</span>
                  {step.reflect && (
                    <span className="ml-auto" style={{ color: "#0d9488", fontSize: "0.6rem" }}>✦</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs mt-3 flex items-center gap-1" style={{ color: "#94a3b8" }}>
            <span>✦</span> Self-Reflection nodes
          </p>
          <div className="mt-4" style={{ height: "1px", background: "#f1f5f9" }} />
          <Link
            href="/dashboard"
            className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all"
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              color: "#64748b",
              textDecoration: "none",
            }}
          >
            <span>📊</span> Eval Dashboard
          </Link>
        </div>

        {/* Reset */}
        {sessionId && (
          <div className="px-6 pb-6 pt-2">
            <div className="mb-4" style={{ height: "1px", background: "#f1f5f9" }} />
            <button
              onClick={handleReset}
              className="w-full rounded-xl py-2.5 text-xs font-medium transition-all"
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#dc2626",
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
          style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0" }}
        >
          <div>
            <h1 className="font-semibold text-base" style={{ color: "#0f172a" }}>
              Clinical Research Assistant
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>
              Hybrid Search · MMR Diversity · Cross-Encoder Reranking · Self-Reflection RAG
            </p>
          </div>
          <div className="flex items-center gap-2">
            {sessionId ? (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                style={{ background: "#f0fdfa", border: "1px solid #99f6e4", color: "#0d9488" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#0d9488" }} />
                Document Ready
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#94a3b8" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#cbd5e1" }} />
                No Document
              </span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
          {!sessionId && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                {/* Hero card */}
                <div
                  className="rounded-2xl p-8 mb-4"
                  style={{ background: "#ffffff", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
                >
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
                    style={{ background: "#f0fdfa", border: "1px solid #99f6e4" }}
                  >
                    🧠
                  </div>
                  <h2 className="font-semibold text-lg mb-2" style={{ color: "#0f172a" }}>
                    Upload a PDF to begin
                  </h2>
                  <p className="text-sm leading-relaxed mb-5" style={{ color: "#64748b" }}>
                    Ask questions about clinical research documents using
                    advanced hybrid retrieval with self-reflection grading.
                  </p>
                  {/* Feature pills */}
                  <div className="flex flex-wrap gap-2 justify-center">
                    {["Hybrid Search", "MMR Diversity", "Cross-Encoder", "Self-Reflection"].map((f) => (
                      <span
                        key={f}
                        className="px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ background: "#f0fdfa", border: "1px solid #99f6e4", color: "#0d9488" }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble key={i} msg={msg} />
          ))}

          {loading && <TypingIndicator />}

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm"
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#dc2626",
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
          style={{ background: "#ffffff", borderTop: "1px solid #e2e8f0" }}
        >
          <div
            className="flex gap-3 items-center rounded-2xl px-4 py-3"
            style={{
              background: "#f8fafc",
              border: `1.5px solid ${canSend ? "#0d9488" : "#e2e8f0"}`,
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
              style={{ color: "#0f172a" }}
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="rounded-xl px-4 py-2 text-xs font-semibold transition-all flex-shrink-0"
              style={{
                background: canSend ? "#0d9488" : "#f1f5f9",
                color: canSend ? "#ffffff" : "#94a3b8",
                cursor: canSend ? "pointer" : "not-allowed",
                boxShadow: canSend ? "0 1px 3px rgba(13,148,136,0.3)" : "none",
                transition: "all 0.2s",
              }}
            >
              Send ↵
            </button>
          </div>
          <p className="text-center text-xs mt-2" style={{ color: "#cbd5e1" }}>
            Answers are grounded in the uploaded document only
          </p>
        </div>
      </main>
    </div>
  );
}
