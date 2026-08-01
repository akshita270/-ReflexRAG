"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { uploadPDF, sendChat, resetSession, fetchSessions, restoreSession } from "@/lib/api";
import type { Message, ReflectionEntry } from "@/lib/types";

type PastSession = { session_id: string; filename: string; chunk_count: number; created_at: string };

// ── Helpers ───────────────────────────────────────────────────
function statusToProgress(status: string): number {
  const s = status.toLowerCase();
  if (s.includes("uploading")) return 20;
  if (s.includes("downloading")) return 40;
  if (s.includes("extracting")) return 60;
  if (s.includes("building")) return 80;
  return 35;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Theme ─────────────────────────────────────────────────────
function useTheme() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("theme") === "dark") {
      setIsDark(true);
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);
  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("theme", next ? "dark" : "light");
  }
  return { isDark, toggle };
}

// ── Sub-components ────────────────────────────────────────────

function ProgressBar({ progress, status }: { progress: number; status: string }) {
  return (
    <div className="mt-3">
      <div className="w-full rounded-full overflow-hidden" style={{ height: "3px", background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress}%`, background: "linear-gradient(90deg, var(--accent), #5eead4)" }}
        />
      </div>
      <p className="text-xs mt-1.5 text-center" style={{ color: "var(--text-subtle)" }}>
        {status}
      </p>
    </div>
  );
}

function EvalBadge({ log, source }: { log: ReflectionEntry[]; source?: string }) {
  if (source === "cache") {
    return (
      <div className="flex items-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
          ⚡ Exact cache
        </span>
      </div>
    );
  }
  if (source === "semantic_cache") {
    return (
      <div className="flex items-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{ background: "var(--purple-bg)", border: "1px solid var(--purple)", color: "var(--purple)" }}>
          🔮 Semantic cache
        </span>
      </div>
    );
  }
  const last = log[log.length - 1];
  if (!last) return null;
  const ok = last.faithful && last.relevant;
  const ctxPct = last.retrieved > 0 ? Math.round((last.after_grading / last.retrieved) * 100) : 0;
  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
        style={{
          background: ok ? "var(--success-bg)" : "var(--danger-bg)",
          border: `1px solid ${ok ? "var(--success)" : "var(--danger)"}`,
          color: ok ? "var(--success)" : "var(--danger)",
        }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: ok ? "var(--success)" : "var(--danger)" }} />
        {ok ? "Verified" : "Low confidence"}
      </span>
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs"
        style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", color: "var(--text-subtle)" }}>
        {ctxPct}% precision
      </span>
      {log.length > 1 && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs"
          style={{ background: "var(--purple-bg)", border: "1px solid var(--purple)", color: "var(--purple)" }}>
          {log.length} iterations
        </span>
      )}
    </div>
  );
}

function ReflectionLog({ log }: { log: ReflectionEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!log.length) return null;
  return (
    <div className="mt-1.5">
      <button onClick={() => setOpen(o => !o)} className="text-xs flex items-center gap-1"
        style={{ color: "var(--text-subtle)" }}>
        <span style={{ fontSize: "0.45rem" }}>{open ? "▲" : "▼"}</span>
        Self-Reflection Log
      </button>
      {open && (
        <div className="mt-2 rounded-xl p-4 text-xs space-y-3"
          style={{ background: "var(--surface-alt)", border: "1px solid var(--border)" }}>
          {log.map(e => (
            <div key={e.iteration} className="space-y-1">
              <p className="font-semibold" style={{ color: "var(--text)" }}>
                Iteration {e.iteration}
                {e.expanded && <span style={{ color: "var(--purple)", fontWeight: 400 }}> · expanded</span>}
              </p>
              <p style={{ color: "var(--text-muted)" }}>
                {e.retrieved} chunks → {e.after_grading} passed grading
              </p>
              <div className="flex gap-4">
                <span style={{ color: e.faithful ? "var(--success)" : "var(--danger)" }}>
                  {e.faithful ? "✓" : "✗"} Faithful
                </span>
                <span style={{ color: e.relevant ? "var(--success)" : "var(--danger)" }}>
                  {e.relevant ? "✓" : "✗"} Relevant
                </span>
              </div>
              {e.reason && <p style={{ color: "var(--text-subtle)", fontStyle: "italic" }}>{e.reason}</p>}
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
    <div className="mt-1.5">
      <button onClick={() => setOpen(o => !o)} className="text-xs flex items-center gap-1"
        style={{ color: "var(--text-subtle)" }}>
        <span style={{ fontSize: "0.45rem" }}>{open ? "▲" : "▼"}</span>
        {chunks.length} source chunks
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {chunks.map((chunk, i) => (
            <div key={i} className="rounded-xl p-3 text-xs leading-relaxed"
              style={{
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
                borderLeft: "3px solid var(--accent)",
                color: "var(--text-muted)",
              }}>
              <p className="font-semibold mb-1 uppercase tracking-wider"
                style={{ fontSize: "0.6rem", color: "var(--accent)" }}>
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
      <div className="flex justify-end msg-animate">
        <div className="max-w-lg rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed"
          style={{ background: "var(--accent)", color: "#fff" }}>
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-3 msg-animate">
      <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm mt-0.5"
        style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}>
        🧠
      </div>
      <div className="flex-1 max-w-2xl">
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed"
          style={{
            background: isNotFound ? "var(--danger-bg)" : "var(--surface)",
            border: `1px solid ${isNotFound ? "var(--danger)" : "var(--border)"}`,
            color: isNotFound ? "var(--danger)" : "var(--text)",
            boxShadow: "var(--shadow)",
          }}>
          {msg.content}
        </div>
        {msg.reflection_log && <EvalBadge log={msg.reflection_log} source={msg.source} />}
        {msg.chunks && <ChunkViewer chunks={msg.chunks} />}
        {msg.reflection_log && <ReflectionLog log={msg.reflection_log} />}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start gap-3 msg-animate">
      <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm"
        style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}>
        🧠
      </div>
      <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm flex items-center gap-2"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-subtle)", boxShadow: "var(--shadow)" }}>
        <span className="animate-pulse">Searching</span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>Reflecting</span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>Generating</span>
      </div>
    </div>
  );
}

const PIPELINE_STEPS = [
  { label: "PDF Load & Clean",     icon: "01", reflect: false },
  { label: "Sentence Chunking",    icon: "02", reflect: false },
  { label: "FAISS + BM25 Index",   icon: "03", reflect: false },
  { label: "Hybrid Search (RRF)",  icon: "04", reflect: false },
  { label: "MMR Diversity",        icon: "05", reflect: false },
  { label: "Cross-Encoder Rerank", icon: "06", reflect: false },
  { label: "Retrieval Grading",    icon: "07", reflect: true  },
  { label: "GPT-4o mini",          icon: "08", reflect: false },
  { label: "Answer Grading",       icon: "09", reflect: true  },
];

// ── Main ──────────────────────────────────────────────────────
export default function Home() {
  const { isDark, toggle: toggleTheme } = useTheme();

  const [sessionId, setSessionId]           = useState<string | null>(null);
  const [filename, setFilename]             = useState<string | null>(null);
  const [chunkCount, setChunkCount]         = useState<number>(0);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [input, setInput]                   = useState("");
  const [uploading, setUploading]           = useState(false);
  const [uploadStatus, setUploadStatus]     = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loading, setLoading]               = useState(false);
  const [restoring, setRestoring]           = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [pastSessions, setPastSessions]     = useState<PastSession[]>([]);
  const [isDragging, setIsDragging]         = useState(false);

  const dragDepth = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    fetchSessions().then(setPastSessions);
  }, []);

  async function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }
    setUploading(true);
    setUploadProgress(10);
    setUploadStatus("Uploading to S3...");
    setError(null);
    try {
      const res = await uploadPDF(file, (status) => {
        setUploadStatus(status);
        setUploadProgress(statusToProgress(status));
      });
      setUploadProgress(100);
      setTimeout(() => { setUploadProgress(0); setUploadStatus(""); }, 700);
      setSessionId(res.session_id);
      setFilename(res.filename);
      setChunkCount(res.chunk_count);
      setMessages([]);
      fetchSessions().then(setPastSessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadProgress(0);
      setUploadStatus("");
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current++;
    if (dragDepth.current === 1) setIsDragging(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current--;
    if (dragDepth.current === 0) setIsDragging(false);
  }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  async function handleRestore(s: PastSession) {
    setRestoring(true);
    setError(null);
    try {
      const res = await restoreSession(s.session_id);
      setSessionId(res.session_id);
      setFilename(res.filename);
      setChunkCount(res.chunk_count);
      setMessages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }

  async function handleSend() {
    const query = input.trim();
    if (!query || !sessionId || loading) return;
    setInput("");
    setError(null);
    setMessages(prev => [...prev, { role: "user", content: query }]);
    setLoading(true);
    try {
      const res = await sendChat(sessionId, query);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: res.answer,
        chunks: res.chunks,
        reflection_log: res.reflection_log,
        source: res.source,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (sessionId) await resetSession(sessionId);
    setSessionId(null); setFilename(null); setChunkCount(0); setMessages([]);
  }

  const canSend = !!sessionId && !!input.trim() && !loading;

  return (
    <div
      className="flex h-dvh overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "var(--accent-light)", border: "3px dashed var(--accent)", backdropFilter: "blur(2px)" }}>
          <div className="text-center">
            <div className="text-5xl mb-3">📄</div>
            <p className="text-xl font-semibold" style={{ color: "var(--accent)" }}>Drop your PDF here</p>
            <p className="text-sm mt-1" style={{ color: "var(--text-subtle)" }}>Release to start processing</p>
          </div>
        </div>
      )}

      {/* ── SIDEBAR ───────────────────────────────────────────── */}
      <aside className="w-72 flex-shrink-0 flex flex-col overflow-hidden"
        style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}>

        {/* Logo + theme toggle */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
              style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}>
              🧠
            </div>
            <div>
              <p className="font-bold text-sm" style={{ color: "var(--text)" }}>ReflexRAG</p>
              <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Clinical PDF Assistant</p>
            </div>
          </div>
          <button onClick={toggleTheme}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
            style={{ background: "var(--surface-alt)", border: "1px solid var(--border)" }}
            title="Toggle theme">
            {isDark ? "☀️" : "🌙"}
          </button>
        </div>

        <div style={{ height: "1px", background: "var(--border)" }} />

        {/* Upload */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-subtle)" }}>
            Document
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-xl py-2.5 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-all"
            style={{
              background: uploading ? "var(--accent-light)" : "var(--accent)",
              color: uploading ? "var(--accent)" : "#fff",
              cursor: uploading ? "wait" : "pointer",
              boxShadow: uploading ? "none" : "0 2px 8px rgba(13,148,136,0.25)",
            }}>
            {uploading
              ? <><span className="spin">⟳</span> Processing...</>
              : <>↑ Upload PDF</>}
          </button>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFileInput} />

          {uploading && uploadProgress > 0 && (
            <ProgressBar progress={uploadProgress} status={uploadStatus} />
          )}

          {filename && !uploading && (
            <div className="mt-3 rounded-xl p-3"
              style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}>
              <div className="flex items-start gap-2">
                <span className="text-sm mt-0.5">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>{filename}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--accent)" }}>{chunkCount} chunks indexed</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ height: "1px", background: "var(--border)" }} />

        {/* Recent docs */}
        {pastSessions.length > 0 && (
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-subtle)" }}>
              Recent Documents
            </p>
            <div className="space-y-0.5">
              {pastSessions.slice(0, 5).map(s => {
                const active = s.session_id === sessionId;
                return (
                  <button
                    key={s.session_id}
                    onClick={() => handleRestore(s)}
                    disabled={restoring || active}
                    className="w-full text-left rounded-xl px-3 py-2 text-xs transition-all"
                    style={{
                      background: active ? "var(--accent-light)" : "transparent",
                      border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`,
                      cursor: restoring ? "wait" : "pointer",
                    }}>
                    <div className="flex items-center gap-2">
                      <span>📄</span>
                      <span className="truncate flex-1 font-medium" style={{ color: "var(--text)" }}>{s.filename}</span>
                      {active && <span style={{ color: "var(--accent)", fontSize: "0.55rem" }}>●</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 pl-6">
                      <span style={{ color: "var(--text-subtle)" }}>{formatDate(s.created_at)}</span>
                      {s.chunk_count > 0 && (
                        <><span style={{ color: "var(--border)" }}>·</span>
                        <span style={{ color: "var(--text-subtle)" }}>{s.chunk_count} chunks</span></>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {restoring && (
              <p className="text-xs mt-2 text-center" style={{ color: "var(--accent)" }}>
                Rebuilding index from S3...
              </p>
            )}
          </div>
        )}

        <div style={{ height: "1px", background: "var(--border)" }} />

        {/* Pipeline */}
        <div className="px-5 py-4 flex-1 overflow-y-auto">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-subtle)" }}>
            Pipeline
          </p>
          <div className="space-y-0.5">
            {PIPELINE_STEPS.map(step => (
              <div key={step.label}
                className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs"
                style={{
                  background: step.reflect ? "var(--accent-light)" : "transparent",
                  color: step.reflect ? "var(--accent)" : "var(--text-muted)",
                }}>
                <span className="font-mono flex-shrink-0"
                  style={{ fontSize: "0.55rem", color: step.reflect ? "var(--accent)" : "var(--text-subtle)" }}>
                  {step.icon}
                </span>
                <span className={step.reflect ? "font-semibold" : ""}>{step.label}</span>
                {step.reflect && <span className="ml-auto" style={{ fontSize: "0.55rem" }}>✦</span>}
              </div>
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--text-subtle)" }}>✦ Self-Reflection nodes</p>

          <div className="mt-3" style={{ height: "1px", background: "var(--border)" }} />
          <Link href="/dashboard"
            className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium"
            style={{
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              textDecoration: "none",
              display: "flex",
            }}>
            <span>📊</span> Eval Dashboard
          </Link>
        </div>

        {/* Reset */}
        {sessionId && (
          <div className="px-5 pb-5 pt-2">
            <div className="mb-3" style={{ height: "1px", background: "var(--border)" }} />
            <button onClick={handleReset}
              className="w-full rounded-xl py-2.5 text-xs font-medium"
              style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
              Reset Session
            </button>
          </div>
        )}
      </aside>

      {/* ── MAIN ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>

        {/* Header */}
        <div className="px-8 py-4 flex items-center justify-between flex-shrink-0"
          style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h1 className="font-semibold text-base" style={{ color: "var(--text)" }}>
              Clinical Research Assistant
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-subtle)" }}>
              Hybrid Search · MMR Diversity · Cross-Encoder Reranking · Self-Reflection RAG
            </p>
          </div>
          {sessionId ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
              Document Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", color: "var(--text-subtle)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--border)" }} />
              No Document
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
          {!sessionId && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <div className="rounded-2xl p-8"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)" }}>
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
                    style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}>
                    🧠
                  </div>
                  <h2 className="font-semibold text-lg mb-2" style={{ color: "var(--text)" }}>
                    Upload a PDF to begin
                  </h2>
                  <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--text-muted)" }}>
                    Ask questions about clinical research documents using
                    advanced hybrid retrieval with self-reflection grading.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center mb-4">
                    {["Hybrid Search", "MMR Diversity", "Cross-Encoder", "Self-Reflection"].map(f => (
                      <span key={f} className="px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
                        {f}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
                    💡 Or drag &amp; drop a PDF anywhere on this page
                  </p>
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}

          {loading && <TypingIndicator />}

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm"
              style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-8 py-4 flex-shrink-0"
          style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          <div className="flex gap-3 items-center rounded-2xl px-4 py-3 transition-all"
            style={{
              background: "var(--surface-alt)",
              border: `1.5px solid ${canSend ? "var(--accent)" : "var(--border)"}`,
            }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={sessionId ? "Ask anything about the document..." : "Upload a PDF first"}
              disabled={!sessionId || loading}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--text)" }}
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="rounded-xl px-4 py-2 text-xs font-semibold flex-shrink-0 transition-all"
              style={{
                background: canSend ? "var(--accent)" : "var(--border)",
                color: canSend ? "#fff" : "var(--text-subtle)",
                cursor: canSend ? "pointer" : "not-allowed",
                boxShadow: canSend ? "0 1px 4px rgba(13,148,136,0.3)" : "none",
              }}>
              Send ↵
            </button>
          </div>
          <p className="text-center text-xs mt-2" style={{ color: "var(--text-subtle)" }}>
            Answers are grounded in the uploaded document only
          </p>
        </div>
      </main>
    </div>
  );
}
