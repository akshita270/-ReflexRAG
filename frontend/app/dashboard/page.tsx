"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchMetrics } from "@/lib/api";

type Stats = {
  total_queries: number;
  faithfulness_pct: number;
  relevance_pct: number;
  cache_hit_pct: number;
  avg_response_ms: number;
  avg_context_pct: number;
  exact_hits: number;
  semantic_hits: number;
};

type RecentQuery = {
  query: string;
  faithful: boolean;
  relevant: boolean;
  context_precision: number;
  response_time_ms: number;
  cache_hit: boolean;
  semantic_cache_hit: boolean;
  iterations: number;
  created_at: string;
  filename: string;
};

type PerDoc = {
  filename: string;
  total_queries: number;
  faithfulness_pct: number;
  avg_context_pct: number;
  avg_ms: number;
};

type MetricsData = { stats: Stats; recent: RecentQuery[]; per_doc: PerDoc[] };

// ── Theme ─────────────────────────────────────────────────────
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

// ── Icons ─────────────────────────────────────────────────────
const Ic = {
  sun: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ),
  moon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  brain: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
    </svg>
  ),
  file: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  back: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/>
      <polyline points="12 19 5 12 12 5"/>
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
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  refresh: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  ),
};

// ── Components ────────────────────────────────────────────────

function GradientBar({ value, color1, color2 }: { value: number; color1: string; color2: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={{ position: "relative" }}>
      <div style={{
        height: 6, borderRadius: 99,
        background: "var(--border)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%", borderRadius: 99,
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color1}, ${color2})`,
          transition: "width 0.8s cubic-bezier(0.16,1,0.3,1)",
          boxShadow: `0 0 8px ${color1}66`,
        }} />
      </div>
      <span style={{ position: "absolute", right: 0, top: -18, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
        {value}%
      </span>
    </div>
  );
}

function BentoCard({
  children, span = 1, style = {},
}: {
  children: React.ReactNode; span?: number; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      borderRadius: 16, padding: "20px 22px",
      background: "var(--glass)",
      border: "1px solid var(--border)",
      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      gridColumn: `span ${span}`,
      ...style,
    }}>
      {children}
    </div>
  );
}

function StatLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-subtle)", marginBottom: 8 }}>
      {children}
    </p>
  );
}

function BigNumber({ value, unit = "", color = "var(--text)" }: { value: number | string; unit?: string; color?: string }) {
  return (
    <p style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-1px", lineHeight: 1, color }}>
      {value}
      {unit && <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text-subtle)", marginLeft: 2 }}>{unit}</span>}
    </p>
  );
}

function CacheSourceBadge({ hit, semantic }: { hit: boolean; semantic: boolean }) {
  const pill: React.CSSProperties = { padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 };
  if (hit) return <span style={{ ...pill, background: "var(--accent-light)", color: "var(--accent)" }}>{Ic.zap} exact</span>;
  if (semantic) return <span style={{ ...pill, background: "var(--purple-bg)", color: "var(--purple)" }}>★ semantic</span>;
  return <span style={{ ...pill, background: "var(--surface)", color: "var(--text-subtle)" }}>{Ic.brain} pipeline</span>;
}

function StatusBadge({ faithful, relevant, cacheHit, semanticHit }: { faithful: boolean; relevant: boolean; cacheHit: boolean; semanticHit: boolean }) {
  const pill: React.CSSProperties = { padding: "3px 10px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 };
  if (cacheHit || semanticHit) {
    return (
      <span style={{ ...pill, background: "var(--accent-light)", color: "var(--accent)", border: "1px solid var(--accent-border)" }}>
        {Ic.zap} Cached
      </span>
    );
  }
  if (faithful && relevant) {
    return (
      <span style={{ ...pill, background: "var(--success-bg)", color: "var(--success)", border: "1px solid rgba(16,185,129,0.2)" }}>
        {Ic.check} Passed
      </span>
    );
  }
  if (faithful || relevant) {
    return (
      <span style={{ ...pill, background: "rgba(245,158,11,0.10)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
        ~ Partial
      </span>
    );
  }
  return (
    <span style={{ ...pill, background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248,113,113,0.2)" }}>
      {Ic.warn} Failed
    </span>
  );
}

function formatTimestamp(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Page ──────────────────────────────────────────────────────
export default function Dashboard() {
  const { isDark, toggle: toggleTheme } = useTheme();
  const [data, setData]       = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetchMetrics()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%", margin: "0 auto 14px",
            border: "2px solid var(--border)",
            borderTop: "2px solid var(--accent)",
            animation: "spin 0.8s linear infinite",
          }} />
          <p style={{ fontSize: 13, color: "var(--text-subtle)" }}>Loading metrics…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "var(--danger-bg)", border: "1px solid var(--danger)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {Ic.warn}
          </div>
          <div>
            <p style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              Could not load metrics
            </p>
            <p style={{ color: "var(--text-subtle)", fontSize: 13 }}>
              {error || "Backend may be starting up"}
            </p>
          </div>
          <button
            onClick={load}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "9px 20px", borderRadius: 10, border: "1px solid var(--border)",
              background: "var(--glass)", backdropFilter: "blur(12px)",
              color: "var(--text)", fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            {Ic.refresh} Retry
          </button>
          <Link href="/" style={{ fontSize: 12, color: "var(--text-subtle)", textDecoration: "none" }}>
            ← Back to chat
          </Link>
        </div>
      </div>
    );
  }

  const { stats, recent, per_doc } = data;
  const pipelineRuns = (stats.total_queries || 0) - (stats.exact_hits || 0) - (stats.semantic_hits || 0);
  const faithOk = (stats.faithfulness_pct || 0) >= 80;
  const relOk   = (stats.relevance_pct || 0) >= 80;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", position: "relative", zIndex: 1 }}>

      {/* Header */}
      <div style={{
        background: "var(--header-bg)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--border)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "13px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 10px var(--accent-glow)",
              }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#fff" }}>RR</span>
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>ReflexRAG</span>
            </Link>
            <span style={{ color: "var(--border)", fontSize: 16 }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>Eval Dashboard</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              style={{
                width: 30, height: 30, borderRadius: 8,
                background: "var(--surface)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--text-subtle)",
              }}
            >
              {isDark ? Ic.sun : Ic.moon}
            </button>
            <Link href="/" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 13px", borderRadius: 8, textDecoration: "none",
              background: "var(--surface)", border: "1px solid var(--border)",
              color: "var(--text-muted)", fontSize: 12, fontWeight: 500,
            }}>
              {Ic.back} Back to Chat
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 28px 48px" }}>

        {/* ── Bento stat grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14, marginBottom: 20 }}>

          {/* Total queries — wide */}
          <BentoCard style={{ gridColumn: "span 2", background: "linear-gradient(135deg, var(--accent-light), rgba(129,140,248,0.08))" }}>
            <StatLabel>Total Queries</StatLabel>
            <BigNumber value={stats.total_queries || 0} color="var(--text)" />
            <p style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 6 }}>lifetime requests</p>
          </BentoCard>

          {/* Faithfulness */}
          <BentoCard style={{ background: faithOk ? "var(--success-bg)" : "var(--danger-bg)" }}>
            <StatLabel>Faithfulness</StatLabel>
            <BigNumber value={stats.faithfulness_pct || 0} unit="%" color={faithOk ? "var(--success)" : "var(--danger)"} />
          </BentoCard>

          {/* Relevance */}
          <BentoCard style={{ background: relOk ? "var(--success-bg)" : "var(--danger-bg)" }}>
            <StatLabel>Relevance</StatLabel>
            <BigNumber value={stats.relevance_pct || 0} unit="%" color={relOk ? "var(--success)" : "var(--danger)"} />
          </BentoCard>

          {/* Avg response */}
          <BentoCard>
            <StatLabel>Avg Response</StatLabel>
            <BigNumber value={Math.round(stats.avg_response_ms || 0)} unit="ms" color="var(--accent-2)" />
          </BentoCard>

          {/* Context precision */}
          <BentoCard>
            <StatLabel>Context Precision</StatLabel>
            <BigNumber value={stats.avg_context_pct || 0} unit="%" color="var(--accent)" />
          </BentoCard>
        </div>

        {/* ── Second row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>

          {/* Quality breakdown */}
          <BentoCard>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px", marginBottom: 20 }}>
              Answer Quality
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14, fontWeight: 500 }}>Faithfulness</p>
                <GradientBar
                  value={Number(stats.faithfulness_pct) || 0}
                  color1={faithOk ? "#10b981" : "#f87171"}
                  color2={faithOk ? "#34d399" : "#fca5a5"}
                />
              </div>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14, fontWeight: 500 }}>Relevance</p>
                <GradientBar
                  value={Number(stats.relevance_pct) || 0}
                  color1={relOk ? "#10b981" : "#f87171"}
                  color2={relOk ? "#34d399" : "#fca5a5"}
                />
              </div>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14, fontWeight: 500 }}>Context Precision</p>
                <GradientBar value={Number(stats.avg_context_pct) || 0} color1="var(--accent)" color2="var(--accent-2)" />
              </div>
            </div>
          </BentoCard>

          {/* Cache breakdown */}
          <BentoCard>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px", marginBottom: 20 }}>
              Cache Breakdown
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                {
                  label: "Exact Cache Hits", sub: "identical query",
                  value: stats.exact_hits || 0, color: "var(--accent)",
                  badge: <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "var(--accent-light)", color: "var(--accent)", fontWeight: 600 }}>{Ic.zap} exact</span>,
                },
                {
                  label: "Semantic Cache Hits", sub: "≥92% similar meaning",
                  value: stats.semantic_hits || 0, color: "var(--purple)",
                  badge: <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "var(--purple-bg)", color: "var(--purple)", fontWeight: 600 }}>★ semantic</span>,
                },
                {
                  label: "Full Pipeline Runs", sub: "RAG + self-reflection",
                  value: pipelineRuns, color: "var(--text)",
                  badge: <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "var(--surface)", color: "var(--text-subtle)", fontWeight: 600 }}>pipeline</span>,
                },
              ].map((item, i, arr) => (
                <div key={item.label} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 0",
                  borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{item.label}</p>
                      {item.badge}
                    </div>
                    <p style={{ fontSize: 10.5, color: "var(--text-subtle)" }}>{item.sub}</p>
                  </div>
                  <p style={{ fontSize: 28, fontWeight: 800, color: item.color, letterSpacing: "-0.5px" }}>{item.value}</p>
                </div>
              ))}
            </div>
          </BentoCard>
        </div>

        {/* ── Recent queries table ── */}
        <div style={{
          borderRadius: 16, overflow: "hidden",
          background: "var(--glass)",
          border: "1px solid var(--border)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          marginBottom: 20,
        }}>
          <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px" }}>Recent Queries</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-alt)", borderBottom: "1px solid var(--border)" }}>
                  {[
                    { label: "Query", align: "left", pad: "11px 18px" },
                    { label: "Status", align: "center", pad: "11px 14px" },
                    { label: "Document", align: "left", pad: "11px 14px" },
                    { label: "Faithful", align: "center", pad: "11px 12px" },
                    { label: "Relevant", align: "center", pad: "11px 12px" },
                    { label: "Context", align: "center", pad: "11px 12px" },
                    { label: "Iters", align: "center", pad: "11px 12px" },
                    { label: "Response", align: "center", pad: "11px 12px" },
                    { label: "Source", align: "center", pad: "11px 12px" },
                    { label: "When", align: "center", pad: "11px 14px" },
                  ].map(h => (
                    <th
                      key={h.label}
                      style={{
                        padding: h.pad,
                        textAlign: h.align as "left" | "center",
                        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                        letterSpacing: "0.07em", color: "var(--text-subtle)",
                        whiteSpace: "nowrap",
                      }}
                    >{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: "40px 22px", textAlign: "center", color: "var(--text-subtle)", fontSize: 13 }}>
                      No queries yet — start chatting with a document.
                    </td>
                  </tr>
                ) : recent.map((r, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: "1px solid var(--border)", transition: "background 0.1s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-alt)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Query */}
                    <td style={{
                      padding: "11px 18px", color: "var(--text)", maxWidth: 240,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      fontWeight: 500,
                    }}>
                      {r.query}
                    </td>
                    {/* Status */}
                    <td style={{ padding: "11px 14px", textAlign: "center", whiteSpace: "nowrap" }}>
                      <StatusBadge
                        faithful={r.faithful}
                        relevant={r.relevant}
                        cacheHit={r.cache_hit}
                        semanticHit={r.semantic_cache_hit}
                      />
                    </td>
                    {/* Document */}
                    <td style={{
                      padding: "11px 14px", color: "var(--text-muted)", maxWidth: 130,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.filename || "—"}
                    </td>
                    {/* Faithful */}
                    <td style={{ padding: "11px 12px", textAlign: "center" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 20, height: 20, borderRadius: "50%",
                        background: r.faithful ? "var(--success-bg)" : "var(--danger-bg)",
                        color: r.faithful ? "var(--success)" : "var(--danger)",
                      }}>
                        {r.faithful ? Ic.check : Ic.warn}
                      </span>
                    </td>
                    {/* Relevant */}
                    <td style={{ padding: "11px 12px", textAlign: "center" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 20, height: 20, borderRadius: "50%",
                        background: r.relevant ? "var(--success-bg)" : "var(--danger-bg)",
                        color: r.relevant ? "var(--success)" : "var(--danger)",
                      }}>
                        {r.relevant ? Ic.check : Ic.warn}
                      </span>
                    </td>
                    {/* Context */}
                    <td style={{ padding: "11px 12px", textAlign: "center", color: "var(--text-muted)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                      {r.context_precision != null ? `${Math.round(r.context_precision * 100)}%` : "—"}
                    </td>
                    {/* Iterations */}
                    <td style={{ padding: "11px 12px", textAlign: "center" }}>
                      {r.iterations != null ? (
                        <span style={{
                          display: "inline-block",
                          padding: "2px 8px", borderRadius: 99,
                          fontSize: 10.5, fontWeight: 600,
                          background: r.iterations > 1 ? "var(--purple-bg)" : "var(--surface)",
                          color: r.iterations > 1 ? "var(--purple)" : "var(--text-subtle)",
                          fontVariantNumeric: "tabular-nums",
                        }}>
                          ×{r.iterations}
                        </span>
                      ) : "—"}
                    </td>
                    {/* Response time */}
                    <td style={{ padding: "11px 12px", textAlign: "center", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {r.response_time_ms != null ? `${r.response_time_ms}ms` : "—"}
                    </td>
                    {/* Source */}
                    <td style={{ padding: "11px 12px", textAlign: "center", whiteSpace: "nowrap" }}>
                      <CacheSourceBadge hit={r.cache_hit} semantic={r.semantic_cache_hit} />
                    </td>
                    {/* Timestamp */}
                    <td style={{ padding: "11px 14px", textAlign: "center", color: "var(--text-subtle)", fontSize: 11, whiteSpace: "nowrap" }}>
                      {formatTimestamp(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Per-document breakdown ── */}
        {per_doc.length > 0 && (
          <div style={{
            borderRadius: 16, overflow: "hidden",
            background: "var(--glass)",
            border: "1px solid var(--border)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          }}>
            <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px" }}>Per-Document Breakdown</p>
            </div>
            <div>
              {per_doc.map((d, i) => (
                <div key={i} style={{ padding: "18px 22px", borderBottom: i < per_doc.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ color: "var(--accent)", flexShrink: 0 }}>{Ic.file}</div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{d.filename || "Unknown"}</p>
                        <p style={{ fontSize: 10.5, color: "var(--text-subtle)", marginTop: 2 }}>
                          {d.total_queries} queries · avg {d.avg_ms}ms
                        </p>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--text-subtle)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>
                        Faithfulness
                      </p>
                      <GradientBar
                        value={Number(d.faithfulness_pct) || 0}
                        color1={(d.faithfulness_pct || 0) >= 80 ? "#10b981" : "#f87171"}
                        color2={(d.faithfulness_pct || 0) >= 80 ? "#34d399" : "#fca5a5"}
                      />
                    </div>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--text-subtle)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>
                        Context Precision
                      </p>
                      <GradientBar value={Number(d.avg_context_pct) || 0} color1="var(--accent)" color2="var(--accent-2)" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
