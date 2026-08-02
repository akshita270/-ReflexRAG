"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { uploadPDF, sendChat, resetSession, fetchSessions, restoreSession } from "@/lib/api";
import type { Message, ReflectionEntry } from "@/lib/types";

type PastSession = { session_id: string; filename: string; chunk_count: number; created_at: string };

// ── SVG Icons ─────────────────────────────────────────────────
const Ic = {
  brain: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
    </svg>
  ),
  upload: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  file: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  ),
  chart: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  sun: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ),
  moon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  send: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  ),
  refresh: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-4"/>
    </svg>
  ),
  chevDown: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  chevUp: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  ),
  zap: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  check: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  warn: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  drag: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  clock: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
};

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

// ── Theme (dark default) ──────────────────────────────────────
function useTheme() {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const dark = saved !== "light";
    setIsDark(dark);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
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

function Spinner() {
  return (
    <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
      <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

function ProgressBar({ progress, status }: { progress: number; status: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ height: 2, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%", borderRadius: 99,
            width: `${progress}%`,
            background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
            transition: "width 0.4s cubic-bezier(0.16,1,0.3,1)",
            boxShadow: "0 0 8px var(--accent-glow)",
          }}
        />
      </div>
      <p style={{ fontSize: 10, color: "var(--text-subtle)", textAlign: "center", marginTop: 5 }}>{status}</p>
    </div>
  );
}

function EvalBadge({
  log, source, faithful, relevant, context_precision, response_time_ms, iterations,
}: {
  log: ReflectionEntry[];
  source?: string;
  faithful?: boolean;
  relevant?: boolean;
  context_precision?: number;
  response_time_ms?: number;
  iterations?: number;
}) {
  const pillBase: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 500,
  };

  const timePill = response_time_ms != null ? (
    <span style={{ ...pillBase, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-subtle)" }}>
      {response_time_ms < 1000 ? `${response_time_ms}ms` : `${(response_time_ms / 1000).toFixed(1)}s`}
    </span>
  ) : null;

  if (source === "cache") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ ...pillBase, background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
          {Ic.zap} Exact cache
        </span>
        {timePill}
      </div>
    );
  }
  if (source === "semantic_cache") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ ...pillBase, background: "var(--purple-bg)", border: "1px solid var(--purple)", color: "var(--purple)" }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          Semantic cache
        </span>
        {timePill}
      </div>
    );
  }

  // Pipeline response — use top-level eval fields if available, fall back to last reflection entry
  const last = log[log.length - 1];
  const isFaithful = faithful ?? last?.faithful ?? true;
  const isRelevant = relevant ?? last?.relevant ?? true;
  const ok = isFaithful && isRelevant;
  const ctxPct = context_precision != null
    ? Math.round(context_precision * 100)
    : (last && last.retrieved > 0 ? Math.round((last.after_grading / last.retrieved) * 100) : 0);
  const iters = iterations ?? log.length;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      {/* Faithful */}
      <span style={{
        ...pillBase,
        background: isFaithful ? "var(--success-bg)" : "var(--danger-bg)",
        border: `1px solid ${isFaithful ? "rgba(16,185,129,0.3)" : "rgba(248,113,113,0.3)"}`,
        color: isFaithful ? "var(--success)" : "var(--danger)",
      }}>
        {isFaithful ? Ic.check : Ic.warn} Faithful
      </span>
      {/* Relevant */}
      <span style={{
        ...pillBase,
        background: isRelevant ? "var(--success-bg)" : "var(--danger-bg)",
        border: `1px solid ${isRelevant ? "rgba(16,185,129,0.3)" : "rgba(248,113,113,0.3)"}`,
        color: isRelevant ? "var(--success)" : "var(--danger)",
      }}>
        {isRelevant ? Ic.check : Ic.warn} Relevant
      </span>
      {/* Context precision */}
      <span style={{ ...pillBase, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-subtle)" }}>
        {ctxPct}% ctx
      </span>
      {/* Iterations */}
      {iters > 1 && (
        <span style={{ ...pillBase, background: "var(--purple-bg)", border: "1px solid rgba(167,139,250,0.3)", color: "var(--purple)" }}>
          ×{iters} iters
        </span>
      )}
      {/* Response time */}
      {timePill}
    </div>
  );
}

function ReflectionLog({ log }: { log: ReflectionEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!log.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 11, color: "var(--text-subtle)", background: "none", border: "none",
          cursor: "pointer", padding: 0,
        }}
      >
        {open ? Ic.chevUp : Ic.chevDown}
        Self-Reflection Log
      </button>
      {open && (
        <div style={{
          marginTop: 8, borderRadius: 12, padding: "12px 14px",
          background: "var(--surface)", border: "1px solid var(--border)",
          fontSize: 11, display: "flex", flexDirection: "column", gap: 10,
        }}>
          {log.map(e => (
            <div key={e.iteration}>
              <p style={{ fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
                Iteration {e.iteration}
                {e.expanded && <span style={{ color: "var(--purple)", fontWeight: 400 }}> · expanded</span>}
              </p>
              <p style={{ color: "var(--text-muted)" }}>{e.retrieved} chunks → {e.after_grading} passed</p>
              <div style={{ display: "flex", gap: 12, marginTop: 2 }}>
                <span style={{ color: e.faithful ? "var(--success)" : "var(--danger)" }}>
                  {e.faithful ? "✓" : "✗"} Faithful
                </span>
                <span style={{ color: e.relevant ? "var(--success)" : "var(--danger)" }}>
                  {e.relevant ? "✓" : "✗"} Relevant
                </span>
              </div>
              {e.reason && <p style={{ color: "var(--text-subtle)", fontStyle: "italic", marginTop: 2 }}>{e.reason}</p>}
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
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 11, color: "var(--text-subtle)", background: "none", border: "none",
          cursor: "pointer", padding: 0,
        }}
      >
        {open ? Ic.chevUp : Ic.chevDown}
        {chunks.length} source chunks
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {chunks.map((chunk, i) => (
            <div
              key={i}
              style={{
                borderRadius: 10, padding: "10px 12px", fontSize: 11, lineHeight: 1.6,
                background: "var(--surface)", border: "1px solid var(--border)",
                borderLeft: "2px solid var(--accent)", color: "var(--text-muted)",
              }}
            >
              <p style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
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
      <div className="msg-animate" style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{
          maxWidth: 520, padding: "10px 16px", borderRadius: "18px 18px 4px 18px",
          background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)",
          color: "#fff", fontSize: 13.5, lineHeight: 1.6, fontWeight: 400,
          boxShadow: "0 4px 20px var(--accent-glow)",
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="msg-animate" style={{ display: "flex", justifyContent: "flex-start", gap: 10 }}>
      {/* Avatar */}
      <div style={{
        flexShrink: 0, width: 30, height: 30, borderRadius: 10, marginTop: 2,
        background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", boxShadow: "0 2px 10px var(--accent-glow)",
      }}>
        {/* Medical cross */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
          <rect x="9" y="2" width="6" height="20" rx="2.5"/>
          <rect x="2" y="9" width="20" height="6" rx="2.5"/>
        </svg>
      </div>

      <div style={{ flex: 1, maxWidth: 580 }}>
        <div style={{
          padding: "12px 16px", borderRadius: "18px 18px 18px 4px",
          background: isNotFound ? "var(--danger-bg)" : "var(--glass)",
          border: `1px solid ${isNotFound ? "var(--danger)" : "var(--border)"}`,
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          color: isNotFound ? "var(--danger)" : "var(--text)",
          fontSize: 13.5, lineHeight: 1.7,
          boxShadow: "var(--shadow)",
        }}>
          {msg.content}
        </div>
        {msg.reflection_log && (
          <EvalBadge
            log={msg.reflection_log}
            source={msg.source}
            faithful={msg.faithful}
            relevant={msg.relevant}
            context_precision={msg.context_precision}
            response_time_ms={msg.response_time_ms}
            iterations={msg.iterations}
          />
        )}
        {msg.chunks && <ChunkViewer chunks={msg.chunks} />}
        {msg.reflection_log && <ReflectionLog log={msg.reflection_log} />}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="msg-animate" style={{ display: "flex", justifyContent: "flex-start", gap: 10 }}>
      <div style={{
        flexShrink: 0, width: 30, height: 30, borderRadius: 10,
        background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", boxShadow: "0 2px 10px var(--accent-glow)",
      }}>
        {/* Medical cross */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
          <rect x="9" y="2" width="6" height="20" rx="2.5"/>
          <rect x="2" y="9" width="20" height="6" rx="2.5"/>
        </svg>
      </div>
      <div style={{
        padding: "14px 18px", borderRadius: "18px 18px 18px 4px",
        background: "var(--glass)", border: "1px solid var(--border)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", gap: 5,
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--accent)",
            display: "inline-block",
            animation: `typingDot 1.2s ease-in-out infinite`,
            animationDelay: `${i * 0.18}s`,
          }} />
        ))}
      </div>
    </div>
  );
}

const PIPELINE_STEPS = [
  { label: "PDF Load & Clean",     num: "01", reflect: false },
  { label: "Sentence Chunking",    num: "02", reflect: false },
  { label: "FAISS + BM25 Index",   num: "03", reflect: false },
  { label: "Hybrid Search (RRF)",  num: "04", reflect: false },
  { label: "MMR Diversity",        num: "05", reflect: false },
  { label: "Cross-Encoder Rerank", num: "06", reflect: false },
  { label: "Retrieval Grading",    num: "07", reflect: true  },
  { label: "GPT-4o mini",          num: "08", reflect: false },
  { label: "Answer Grading",       num: "09", reflect: true  },
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
        faithful: res.faithful,
        relevant: res.relevant,
        context_precision: res.context_precision,
        response_time_ms: res.response_time_ms,
        iterations: res.iterations,
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

  // Shared style helpers
  const divider = <div style={{ height: 1, background: "var(--border)", margin: "0" }} />;

  return (
    <div
      style={{ display: "flex", height: "100dvh", overflow: "hidden", position: "relative", zIndex: 1 }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* ── Drag overlay ───────────────────────────────────────── */}
      {isDragging && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--accent-light)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        }}>
          <div style={{
            position: "absolute", inset: 16, borderRadius: 20,
            border: "2px dashed var(--accent)",
            animation: "borderGlow 1.5s ease-in-out infinite",
          }} />
          <div style={{ textAlign: "center", color: "var(--accent)" }}>
            <div style={{ marginBottom: 12, opacity: 0.9 }}>{Ic.drag}</div>
            <p style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.5px" }}>Drop your PDF here</p>
            <p style={{ fontSize: 13, color: "var(--text-subtle)", marginTop: 4 }}>Release to start processing</p>
          </div>
        </div>
      )}

      {/* ── SIDEBAR ────────────────────────────────────────────── */}
      <aside style={{
        width: 260, flexShrink: 0,
        display: "flex", flexDirection: "column", overflow: "hidden",
        background: "var(--sidebar-bg)",
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        borderRight: "1px solid var(--border)",
        position: "relative", zIndex: 10,
      }}>

        {/* Logo */}
        <div style={{ padding: "18px 18px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 16px var(--accent-glow)",
            }}>
              {/* Medical cross logo */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <rect x="9" y="2" width="6" height="20" rx="2.5"/>
                <rect x="2" y="9" width="20" height="6" rx="2.5"/>
              </svg>
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px", lineHeight: 1.2 }}>ReflexRAG</p>
              <p style={{ fontSize: 10, color: "var(--text-subtle)", lineHeight: 1 }}>Healthcare AI</p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: "var(--surface)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "var(--text-subtle)", transition: "all 0.15s",
            }}
          >
            {isDark ? Ic.sun : Ic.moon}
          </button>
        </div>

        {divider}

        {/* Scrollable middle content */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>

        {/* Upload */}
        <div style={{ padding: "14px 16px" }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
            Document
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              width: "100%", padding: "9px 14px", borderRadius: 10, border: "none",
              background: uploading
                ? "var(--accent-light)"
                : "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)",
              color: uploading ? "var(--accent)" : "#fff",
              fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.2px",
              cursor: uploading ? "wait" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              boxShadow: uploading ? "none" : "0 4px 18px var(--accent-glow)",
              transition: "all 0.2s",
            }}
          >
            {uploading ? <><Spinner /> Processing…</> : <>{Ic.upload} Upload PDF</>}
          </button>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleFileInput} />

          {uploading && uploadProgress > 0 && (
            <ProgressBar progress={uploadProgress} status={uploadStatus} />
          )}

          {filename && !uploading && (
            <div style={{
              marginTop: 10, borderRadius: 10, padding: "10px 12px",
              background: "var(--accent-light)", border: "1px solid var(--accent-border)",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ color: "var(--accent)", marginTop: 1, flexShrink: 0 }}>{Ic.file}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {filename}
                  </p>
                  <p style={{ fontSize: 10.5, color: "var(--accent)", marginTop: 2 }}>
                    {chunkCount.toLocaleString()} chunks indexed
                  </p>
                </div>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", flexShrink: 0, marginTop: 4, boxShadow: "0 0 6px var(--success)" }} />
              </div>
            </div>
          )}
        </div>

        {divider}

        {/* Recent docs */}
        {pastSessions.length > 0 && (
          <>
            <div style={{ padding: "12px 16px 8px", flexShrink: 0 }}>
              <p style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                Recent
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 180, overflowY: "auto" }}>
                {pastSessions.slice(0, 8).map(s => {
                  const active = s.session_id === sessionId;
                  return (
                    <button
                      key={s.session_id}
                      onClick={() => handleRestore(s)}
                      disabled={restoring || active}
                      style={{
                        width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 8,
                        background: active ? "var(--accent-light)" : "transparent",
                        border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`,
                        cursor: restoring ? "wait" : active ? "default" : "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: active ? "var(--accent)" : "var(--text-subtle)", flexShrink: 0 }}>{Ic.file}</span>
                        <span style={{ flex: 1, fontSize: 11.5, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.filename}
                        </span>
                        {active && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, paddingLeft: 19 }}>
                        <span style={{ fontSize: 10, color: "var(--text-subtle)" }}>{Ic.clock}</span>
                        <span style={{ fontSize: 10, color: "var(--text-subtle)" }}>{formatDate(s.created_at)}</span>
                        {s.chunk_count > 0 && (
                          <>
                            <span style={{ fontSize: 10, color: "var(--border)" }}>·</span>
                            <span style={{ fontSize: 10, color: "var(--text-subtle)" }}>{s.chunk_count} chunks</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {restoring && (
                <p style={{ fontSize: 10, color: "var(--accent)", textAlign: "center", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <Spinner /> Rebuilding index…
                </p>
              )}
            </div>
            {divider}
          </>
        )}

        {/* Pipeline */}
        <div style={{ padding: "12px 16px", flexShrink: 0 }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
            Pipeline
          </p>
          <div style={{ position: "relative", paddingLeft: 20 }}>
            {/* Vertical connector line */}
            <div style={{
              position: "absolute", left: 7, top: 6, bottom: 6, width: 1,
              background: "linear-gradient(to bottom, var(--accent-border) 0%, var(--border) 70%, transparent 100%)",
            }} />
            {PIPELINE_STEPS.map((step, idx) => (
              <div key={step.label} style={{
                position: "relative", display: "flex", alignItems: "center", gap: 8,
                padding: "4px 0",
                paddingLeft: step.reflect ? 0 : 0,
              }}>
                {/* Node circle */}
                <div style={{
                  position: "absolute", left: -20, width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                  background: step.reflect
                    ? "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)"
                    : "var(--surface-solid)",
                  border: `1.5px solid ${step.reflect ? "var(--accent)" : "var(--border)"}`,
                  boxShadow: step.reflect ? "0 0 8px var(--accent-glow)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }} />
                <span style={{
                  fontSize: 9, fontWeight: 700, color: "var(--text-subtle)", letterSpacing: "0.05em",
                  fontFamily: "monospace", flexShrink: 0, marginLeft: 4,
                }}>
                  {step.num}
                </span>
                <span style={{
                  fontSize: 11, color: step.reflect ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: step.reflect ? 600 : 400,
                }}>
                  {step.label}
                </span>
                {step.reflect && (
                  <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 9 }}>✦</span>
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 9.5, color: "var(--text-subtle)", marginTop: 8, marginLeft: 4 }}>✦ Self-reflection nodes</p>
        </div>

        </div>{/* end scrollable middle */}

        {divider}

        {/* Footer nav */}
        <div style={{ padding: "12px 16px" }}>
          <Link
            href="/dashboard"
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", borderRadius: 10, textDecoration: "none",
              background: "var(--surface)", border: "1px solid var(--border)",
              color: "var(--text-muted)", fontSize: 12, fontWeight: 500,
              transition: "all 0.15s",
            }}
          >
            {Ic.chart}
            Eval Dashboard
          </Link>

          {sessionId && (
            <button
              onClick={handleReset}
              style={{
                width: "100%", marginTop: 8, padding: "8px 12px", borderRadius: 10, border: "none",
                background: "var(--danger-bg)", color: "var(--danger)",
                fontSize: 11.5, fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                transition: "all 0.15s",
              }}
            >
              {Ic.refresh} Reset Session
            </button>
          )}
        </div>
      </aside>

      {/* ── MAIN ───────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 1 }}>

        {/* Header */}
        <div style={{
          padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
          background: "var(--header-bg)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--border)",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Stethoscope icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/>
                <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4"/>
                <circle cx="20" cy="10" r="2"/>
              </svg>
              <h1 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>
                Medical Document Intelligence
              </h1>
            </div>
            <p style={{ fontSize: 10.5, color: "var(--text-subtle)", marginTop: 3, paddingLeft: 28 }}>
              Clinical Trials · Drug Literature · Medical Guidelines · Lab Reports
            </p>
          </div>

          {sessionId ? (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 99, fontSize: 11, fontWeight: 500,
              background: "var(--success-bg)", border: "1px solid var(--success)", color: "var(--success)",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--success)", boxShadow: "0 0 6px var(--success)" }} />
              Document Ready
            </div>
          ) : (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 99, fontSize: 11, fontWeight: 500,
              background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-subtle)",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--border)" }} />
              No Document
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>

          {!sessionId && messages.length === 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", margin: "auto 0" }}>
              <div style={{ textAlign: "center", maxWidth: 440, width: "100%" }}>
                {/* Main card */}
                <div style={{
                  borderRadius: 20, padding: "32px 28px",
                  background: "var(--glass)", border: "1px solid var(--border)",
                  backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                  boxShadow: "var(--shadow-lg)",
                }}>
                  {/* Healthcare hero icon */}
                  <div style={{ margin: "0 auto 20px", position: "relative", width: 72, height: 72 }}>
                    {/* Outer ring */}
                    <div style={{
                      position: "absolute", inset: 0, borderRadius: "50%",
                      border: "1.5px solid var(--accent-border)",
                      animation: "borderGlow 3s ease-in-out infinite",
                    }} />
                    <div style={{
                      width: 72, height: 72, borderRadius: "50%",
                      background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 8px 32px var(--accent-glow)",
                    }}>
                      {/* Stethoscope SVG */}
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/>
                        <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4"/>
                        <circle cx="20" cy="10" r="2"/>
                      </svg>
                    </div>
                  </div>

                  <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.5px", marginBottom: 10 }}>
                    Upload a medical PDF to begin
                  </h2>
                  <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--text-muted)", marginBottom: 22 }}>
                    Instantly query clinical trials, drug studies, medical guidelines, and lab reports with AI-powered self-reflection grading.
                  </p>

                  {/* Healthcare feature chips with icons */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginBottom: 22 }}>
                    {[
                      { label: "Clinical Trials", icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0H5a2 2 0 0 1-2-2V9m6 5h10a2 2 0 0 0 2-2V9m-6 9v3m-3 0h6"/></svg> },
                      { label: "Drug Literature", icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg> },
                      { label: "Medical Guidelines", icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
                      { label: "Lab Reports", icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5h0c-1.4 0-2.5-1.1-2.5-2.5V2"/><path d="M8.5 2h7"/><path d="M14.5 16h-5"/></svg> },
                    ].map(f => (
                      <span key={f.label} style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "5px 12px", borderRadius: 99, fontSize: 11, fontWeight: 500,
                        background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)",
                      }}>
                        {f.icon}{f.label}
                      </span>
                    ))}
                  </div>

                  {/* HIPAA-safe note */}
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 12px", borderRadius: 99, fontSize: 10.5,
                    background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-subtle)",
                    marginBottom: 14,
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    Answers grounded in your document only
                  </div>

                  <p style={{ fontSize: 11, color: "var(--text-subtle)" }}>
                    Drag &amp; drop a PDF anywhere, or use the sidebar upload
                  </p>
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}

          {loading && <TypingIndicator />}

          {error && (
            <div style={{
              borderRadius: 12, padding: "10px 14px", fontSize: 13,
              background: "var(--danger-bg)", border: "1px solid var(--danger)", color: "var(--danger)",
            }}>
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          padding: "14px 20px 16px",
          background: "var(--header-bg)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            borderRadius: 14, padding: "10px 12px 10px 16px",
            background: "var(--glass)",
            border: `1.5px solid ${canSend ? "var(--accent)" : "var(--border)"}`,
            backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            boxShadow: canSend ? "0 0 0 3px var(--accent-glow)" : "none",
            transition: "all 0.2s",
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={sessionId ? "Ask anything about the document…" : "Upload a PDF first"}
              disabled={!sessionId || loading}
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                fontSize: 13.5, color: "var(--text)",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              style={{
                width: 34, height: 34, borderRadius: 9, border: "none", flexShrink: 0,
                background: canSend
                  ? "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)"
                  : "var(--border)",
                color: canSend ? "#fff" : "var(--text-subtle)",
                cursor: canSend ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: canSend ? "0 2px 12px var(--accent-glow)" : "none",
                transition: "all 0.2s",
              }}
            >
              {Ic.send}
            </button>
          </div>
          <p style={{ textAlign: "center", fontSize: 10.5, color: "var(--text-subtle)", marginTop: 8 }}>
            Answers are grounded in the uploaded document only
          </p>
        </div>
      </main>
    </div>
  );
}
