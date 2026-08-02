"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  p95_response_ms: number;
  error_rate_pct: number;
  multi_iter_count: number;
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

type HourlyBucket = { hour: string; count: number };

type MetricsData = {
  stats: Stats;
  recent: RecentQuery[];
  per_doc: PerDoc[];
  hourly: HourlyBucket[];
};

type FilterTab = "all" | "pipeline" | "cached" | "failed";

const REFRESH_INTERVAL = 30;

// ── Theme ──────────────────────────────────────────────────────
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

// ── Icons ──────────────────────────────────────────────────────
const Ic = {
  sun: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  moon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  brain: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>,
  file: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  back: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  zap: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  check: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  warn: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  refresh: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  clock: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  trend: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  alert: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
};

// ── Helpers ────────────────────────────────────────────────────
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

function isQueryFailed(r: RecentQuery) {
  return !r.cache_hit && !r.semantic_cache_hit && (!r.faithful || !r.relevant);
}
function isQueryCached(r: RecentQuery) {
  return r.cache_hit || r.semantic_cache_hit;
}
function isQueryPipeline(r: RecentQuery) {
  return !r.cache_hit && !r.semantic_cache_hit;
}

// ── Sub-components ─────────────────────────────────────────────
function GradientBar({ value, color1, color2 }: { value: number; color1: string; color2: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={{ position: "relative" }}>
      <div style={{ height: 6, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 99, width: `${pct}%`,
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

function BentoCard({ children, span = 1, style = {} }: { children: React.ReactNode; span?: number; style?: React.CSSProperties }) {
  return (
    <div className="bento-card" style={{
      borderRadius: 16, padding: "20px 22px",
      background: "var(--glass)", border: "1px solid var(--border)",
      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.08)",
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
  return <span style={{ ...pill, background: "var(--surface)", color: "var(--text-subtle)" }}>pipeline</span>;
}

function StatusBadge({ faithful, relevant, cacheHit, semanticHit }: { faithful: boolean; relevant: boolean; cacheHit: boolean; semanticHit: boolean }) {
  const pill: React.CSSProperties = { padding: "3px 10px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 };
  if (cacheHit || semanticHit) return <span style={{ ...pill, background: "var(--accent-light)", color: "var(--accent)", border: "1px solid var(--accent-border)" }}>{Ic.zap} Cached</span>;
  if (faithful && relevant) return <span style={{ ...pill, background: "var(--success-bg)", color: "var(--success)", border: "1px solid rgba(16,185,129,0.2)" }}>{Ic.check} Passed</span>;
  if (faithful || relevant) return <span style={{ ...pill, background: "rgba(245,158,11,0.10)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>~ Partial</span>;
  return <span style={{ ...pill, background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248,113,113,0.2)" }}>{Ic.warn} Failed</span>;
}

// ── Trend Chart (pure SVG, no deps) ──────────────────────────
function TrendChart({ hourly }: { hourly: HourlyBucket[] }) {
  const W = 100, H = 48, PAD = 4;
  if (!hourly || hourly.length === 0) {
    return (
      <div style={{ height: H + 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-subtle)" }}>No activity in last 24h</p>
      </div>
    );
  }

  // Fill 24 hour slots
  const now = new Date();
  const slots: number[] = [];
  const labels: string[] = [];
  for (let i = 23; i >= 0; i--) {
    const slotTime = new Date(now);
    slotTime.setHours(slotTime.getHours() - i, 0, 0, 0);
    const slotStr = slotTime.toISOString().slice(0, 13);
    const match = hourly.find(h => h.hour.slice(0, 13) === slotStr);
    slots.push(match?.count ?? 0);
    labels.push(i % 6 === 0 ? `${slotTime.getHours()}h` : "");
  }

  const maxVal = Math.max(...slots, 1);
  const barW = (W - PAD * 2) / slots.length;

  const points = slots.map((v, i) => {
    const x = PAD + i * barW + barW / 2;
    const y = H - PAD - ((v / maxVal) * (H - PAD * 2));
    return `${x},${y}`;
  }).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <polygon
          points={`${PAD},${H} ${points} ${W - PAD},${H}`}
          fill="url(#trendGrad)"
        />
        {/* Line */}
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Dots for non-zero */}
        {slots.map((v, i) => {
          if (v === 0) return null;
          const x = PAD + i * barW + barW / 2;
          const y = H - PAD - ((v / maxVal) * (H - PAD * 2));
          return <circle key={i} cx={x} cy={y} r="1.5" fill="var(--accent)" />;
        })}
      </svg>
      {/* Hour labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {labels.map((l, i) => (
          <span key={i} style={{ fontSize: 9, color: "var(--text-subtle)", width: `${100 / 24}%`, textAlign: "center" }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

// ── Mini sparkline for stat cards ──────────────────────────────
function MiniSparkline({ hourly, color }: { hourly: HourlyBucket[]; color: string }) {
  if (!hourly || hourly.length < 2) return null;
  const vals = hourly.map(h => h.count);
  const max = Math.max(...vals, 1);
  const W = 60, H = 22;
  const step = W / (vals.length - 1);
  const pts = vals.map((v, i) => `${i * step},${H - (v / max) * H}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, display: "block" }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

// ── Countdown ring ─────────────────────────────────────────────
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const r = 8;
  const circ = 2 * Math.PI * r;
  const progress = (seconds / total) * circ;
  return (
    <svg width="20" height="20" style={{ transform: "rotate(-90deg)" }}>
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--accent)" strokeWidth="2"
        strokeDasharray={`${progress} ${circ}`} strokeLinecap="round" />
    </svg>
  );
}

// ── Page ───────────────────────────────────────────────────────
export default function Dashboard() {
  const { isDark, toggle: toggleTheme } = useTheme();
  const [data, setData]           = useState<MetricsData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter]       = useState<FilterTab>("all");
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    fetchMetrics()
      .then(d => { setData(d); setLastUpdated(new Date()); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Auto-refresh ticker
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (refreshRef.current) clearTimeout(refreshRef.current);
    if (!autoRefresh) return;

    setCountdown(REFRESH_INTERVAL);
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { return REFRESH_INTERVAL; }
        return c - 1;
      });
    }, 1000);

    function scheduleNext() {
      refreshRef.current = setTimeout(() => {
        load(true);
        scheduleNext();
      }, REFRESH_INTERVAL * 1000);
    }
    scheduleNext();

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (refreshRef.current) clearTimeout(refreshRef.current);
    };
  }, [autoRefresh, load]);

  if (loading && !data) {
    return (
      <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", margin: "0 auto 14px", border: "2px solid var(--border)", borderTop: "2px solid var(--accent)", animation: "spin 0.8s linear infinite" }} />
          <p style={{ fontSize: 13, color: "var(--text-subtle)" }}>Loading metrics…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "var(--danger-bg)", border: "1px solid var(--danger)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {Ic.warn}
          </div>
          <div>
            <p style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Could not load metrics</p>
            <p style={{ color: "var(--text-subtle)", fontSize: 13 }}>{error || "Backend may be starting up"}</p>
          </div>
          <button onClick={() => load()} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--glass)", backdropFilter: "blur(12px)", color: "var(--text)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            {Ic.refresh} Retry
          </button>
          <Link href="/" style={{ fontSize: 12, color: "var(--text-subtle)", textDecoration: "none" }}>← Back to chat</Link>
        </div>
      </div>
    );
  }

  const { stats, recent, per_doc, hourly = [] } = data;
  const pipelineRuns = (stats.total_queries || 0) - (stats.exact_hits || 0) - (stats.semantic_hits || 0);
  const faithOk = (stats.faithfulness_pct || 0) >= 80;
  const relOk   = (stats.relevance_pct || 0) >= 80;
  const errorOk = (stats.error_rate_pct || 0) < 20;

  const filteredRecent = recent.filter(r => {
    if (filter === "pipeline") return isQueryPipeline(r);
    if (filter === "cached")   return isQueryCached(r);
    if (filter === "failed")   return isQueryFailed(r);
    return true;
  });

  const failedCount  = recent.filter(isQueryFailed).length;
  const cachedCount  = recent.filter(isQueryCached).length;
  const pipeCount    = recent.filter(isQueryPipeline).length;

  return (
    <div data-page="dashboard" style={{ minHeight: "100dvh", background: "var(--bg)", position: "relative", zIndex: 1 }}>

      {/* Header */}
      <div style={{ background: "var(--header-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "13px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 10px var(--accent-glow)" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#fff" }}>RR</span>
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>ReflexRAG</span>
            </Link>
            <span style={{ color: "var(--border)", fontSize: 16 }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>Dashboard</span>
            {/* Live indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: "var(--success-bg)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", boxShadow: "0 0 6px var(--success)", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--success)", letterSpacing: "0.05em" }}>LIVE</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Last updated */}
            {lastUpdated && (
              <span style={{ fontSize: 11, color: "var(--text-subtle)", display: "flex", alignItems: "center", gap: 4 }}>
                {Ic.clock} {formatTimestamp(lastUpdated.toISOString())}
              </span>
            )}
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(a => !a)}
              title={autoRefresh ? "Auto-refresh on" : "Auto-refresh off"}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border)",
                background: autoRefresh ? "var(--accent-light)" : "var(--surface)",
                color: autoRefresh ? "var(--accent)" : "var(--text-subtle)",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              {autoRefresh ? <CountdownRing seconds={countdown} total={REFRESH_INTERVAL} /> : Ic.refresh}
              {autoRefresh ? `${countdown}s` : "Auto"}
            </button>
            <button
              onClick={() => load()}
              title="Refresh now"
              style={{ width: 30, height: 30, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-subtle)" }}
            >
              {Ic.refresh}
            </button>
            <button onClick={toggleTheme} aria-label="Toggle theme" style={{ width: 30, height: 30, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-subtle)" }}>
              {isDark ? Ic.sun : Ic.moon}
            </button>
            <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 8, textDecoration: "none", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, fontWeight: 500 }}>
              {Ic.back} Back to Chat
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 28px 60px" }}>

        {/* ── Failure alert banner ── */}
        {failedCount > 0 && filter !== "cached" && (
          <div style={{
            marginBottom: 18, padding: "12px 18px", borderRadius: 12,
            background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.25)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ color: "var(--danger)" }}>{Ic.alert}</span>
            <span style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 600 }}>
              {failedCount} failed {failedCount === 1 ? "query" : "queries"} in recent activity
            </span>
            <button onClick={() => setFilter("failed")} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--danger)", background: "transparent", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
              View failed →
            </button>
          </div>
        )}

        {/* ── Top KPI row (6-col bento) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14, marginBottom: 14 }}>

          <BentoCard style={{ gridColumn: "span 2", background: "linear-gradient(135deg, rgba(13,148,136,0.14) 0%, rgba(99,102,241,0.10) 100%)", border: "1px solid rgba(13,148,136,0.2)" }}>
            <StatLabel>Total Queries</StatLabel>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
              <BigNumber value={stats.total_queries || 0} color="var(--accent)" />
              <MiniSparkline hourly={hourly} color="var(--accent)" />
            </div>
            <p style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 6 }}>lifetime requests</p>
          </BentoCard>

          <BentoCard style={{
            background: faithOk
              ? "linear-gradient(135deg, rgba(16,185,129,0.14) 0%, rgba(5,150,105,0.07) 100%)"
              : "linear-gradient(135deg, rgba(248,113,113,0.14) 0%, rgba(220,38,38,0.07) 100%)",
            border: faithOk ? "1px solid rgba(16,185,129,0.22)" : "1px solid rgba(248,113,113,0.22)",
          }}>
            <StatLabel>Faithfulness</StatLabel>
            <BigNumber value={stats.faithfulness_pct || 0} unit="%" color={faithOk ? "var(--success)" : "var(--danger)"} />
            <p style={{ fontSize: 10, color: faithOk ? "var(--success)" : "var(--danger)", marginTop: 6, opacity: 0.8 }}>{faithOk ? "✓ healthy" : "↓ below 80%"}</p>
          </BentoCard>

          <BentoCard style={{
            background: relOk
              ? "linear-gradient(135deg, rgba(16,185,129,0.14) 0%, rgba(5,150,105,0.07) 100%)"
              : "linear-gradient(135deg, rgba(248,113,113,0.14) 0%, rgba(220,38,38,0.07) 100%)",
            border: relOk ? "1px solid rgba(16,185,129,0.22)" : "1px solid rgba(248,113,113,0.22)",
          }}>
            <StatLabel>Relevance</StatLabel>
            <BigNumber value={stats.relevance_pct || 0} unit="%" color={relOk ? "var(--success)" : "var(--danger)"} />
            <p style={{ fontSize: 10, color: relOk ? "var(--success)" : "var(--danger)", marginTop: 6, opacity: 0.8 }}>{relOk ? "✓ healthy" : "↓ below 80%"}</p>
          </BentoCard>

          <BentoCard style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(129,140,248,0.06) 100%)", border: "1px solid rgba(99,102,241,0.18)" }}>
            <StatLabel>Avg Latency</StatLabel>
            <BigNumber value={Math.round(stats.avg_response_ms || 0)} unit="ms" color="var(--accent-2)" />
            <p style={{ fontSize: 10, color: "var(--text-subtle)", marginTop: 6 }}>P95: {Math.round(stats.p95_response_ms || 0)}ms</p>
          </BentoCard>

          <BentoCard style={{
            background: errorOk
              ? "linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(13,148,136,0.06) 100%)"
              : "linear-gradient(135deg, rgba(248,113,113,0.14) 0%, rgba(220,38,38,0.07) 100%)",
            border: errorOk ? "1px solid var(--border)" : "1px solid rgba(248,113,113,0.22)",
          }}>
            <StatLabel>Error Rate</StatLabel>
            <BigNumber value={stats.error_rate_pct || 0} unit="%" color={errorOk ? "var(--text)" : "var(--danger)"} />
            <p style={{ fontSize: 10, color: "var(--text-subtle)", marginTop: 6 }}>{stats.multi_iter_count || 0} multi-iter</p>
          </BentoCard>
        </div>

        {/* ── Second row: trend + cache + quality ── */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 14, marginBottom: 14 }}>

          {/* Query volume trend */}
          <BentoCard>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px", display: "flex", alignItems: "center", gap: 6 }}>
                {Ic.trend} Query Volume
              </p>
              <span style={{ fontSize: 10, color: "var(--text-subtle)", fontWeight: 500 }}>last 24 hours</span>
            </div>
            <TrendChart hourly={hourly} />
          </BentoCard>

          {/* Cache breakdown */}
          <BentoCard>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px", marginBottom: 16 }}>Cache Breakdown</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                { label: "Exact hits", value: stats.exact_hits || 0, color: "var(--accent)", badge: <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "var(--accent-light)", color: "var(--accent)", fontWeight: 600 }}>exact</span> },
                { label: "Semantic hits", value: stats.semantic_hits || 0, color: "var(--purple)", badge: <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "var(--purple-bg)", color: "var(--purple)", fontWeight: 600 }}>≥92%</span> },
                { label: "Pipeline runs", value: pipelineRuns, color: "var(--text)", badge: <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "var(--surface)", color: "var(--text-subtle)", fontWeight: 600 }}>RAG</span> },
              ].map((item, i, arr) => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {item.badge}
                    <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{item.label}</p>
                  </div>
                  <p style={{ fontSize: 22, fontWeight: 800, color: item.color, letterSpacing: "-0.5px" }}>{item.value}</p>
                </div>
              ))}
            </div>
          </BentoCard>

          {/* Quality bars */}
          <BentoCard>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px", marginBottom: 20 }}>Answer Quality</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 14, fontWeight: 500 }}>Faithfulness</p>
                <GradientBar value={Number(stats.faithfulness_pct) || 0} color1={faithOk ? "#10b981" : "#f87171"} color2={faithOk ? "#34d399" : "#fca5a5"} />
              </div>
              <div>
                <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 14, fontWeight: 500 }}>Relevance</p>
                <GradientBar value={Number(stats.relevance_pct) || 0} color1={relOk ? "#10b981" : "#f87171"} color2={relOk ? "#34d399" : "#fca5a5"} />
              </div>
              <div>
                <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 14, fontWeight: 500 }}>Context Precision</p>
                <GradientBar value={Number(stats.avg_context_pct) || 0} color1="var(--accent)" color2="var(--accent-2)" />
              </div>
            </div>
          </BentoCard>
        </div>

        {/* ── Recent queries table ── */}
        <div style={{ borderRadius: 16, overflow: "hidden", background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", marginBottom: 14 }}>
          {/* Table header with filter tabs */}
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px" }}>
              Recent Queries
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-subtle)", marginLeft: 8 }}>(last {recent.length})</span>
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              {([ ["all", `All ${recent.length}`], ["pipeline", `Pipeline ${pipeCount}`], ["cached", `Cached ${cachedCount}`], ["failed", `Failed ${failedCount}`] ] as [FilterTab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  style={{
                    padding: "4px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    border: filter === key ? "1px solid var(--accent-border)" : "1px solid var(--border)",
                    background: filter === key ? "var(--accent-light)" : "var(--surface)",
                    color: filter === key ? "var(--accent)" : "var(--text-subtle)",
                    transition: "all 0.15s",
                  }}
                >
                  {key === "failed" && failedCount > 0 ? <span style={{ color: "var(--danger)" }}>{label}</span> : label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-alt)", borderBottom: "1px solid var(--border)" }}>
                  {[
                    { label: "Query", align: "left", pad: "10px 18px" },
                    { label: "Status", align: "center", pad: "10px 14px" },
                    { label: "Document", align: "left", pad: "10px 14px" },
                    { label: "Faithful", align: "center", pad: "10px 12px" },
                    { label: "Relevant", align: "center", pad: "10px 12px" },
                    { label: "Context", align: "center", pad: "10px 12px" },
                    { label: "Iters", align: "center", pad: "10px 12px" },
                    { label: "Response", align: "center", pad: "10px 12px" },
                    { label: "Source", align: "center", pad: "10px 12px" },
                    { label: "When", align: "center", pad: "10px 14px" },
                  ].map(h => (
                    <th key={h.label} style={{ padding: h.pad, textAlign: h.align as "left" | "center", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRecent.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: "40px 22px", textAlign: "center", color: "var(--text-subtle)", fontSize: 13 }}>
                      {filter === "all" ? "No queries yet — start chatting with a document." : `No ${filter} queries in recent activity.`}
                    </td>
                  </tr>
                ) : filteredRecent.map((r, i) => {
                  const failed = isQueryFailed(r);
                  return (
                    <tr
                      key={i}
                      style={{ borderBottom: "1px solid var(--border)", transition: "background 0.1s", background: failed ? "rgba(248,113,113,0.03)" : "transparent" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-alt)")}
                      onMouseLeave={e => (e.currentTarget.style.background = failed ? "rgba(248,113,113,0.03)" : "transparent")}
                    >
                      <td style={{ padding: "10px 18px", color: "var(--text)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{r.query}</td>
                      <td style={{ padding: "10px 14px", textAlign: "center", whiteSpace: "nowrap" }}>
                        <StatusBadge faithful={r.faithful} relevant={r.relevant} cacheHit={r.cache_hit} semanticHit={r.semantic_cache_hit} />
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-muted)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.filename || "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: r.faithful ? "var(--success-bg)" : "var(--danger-bg)", color: r.faithful ? "var(--success)" : "var(--danger)" }}>
                          {r.faithful ? Ic.check : Ic.warn}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: r.relevant ? "var(--success-bg)" : "var(--danger-bg)", color: r.relevant ? "var(--success)" : "var(--danger)" }}>
                          {r.relevant ? Ic.check : Ic.warn}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-muted)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                        {r.context_precision != null ? `${Math.round(r.context_precision * 100)}%` : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        {r.iterations != null ? (
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 600, background: r.iterations > 1 ? "var(--purple-bg)" : "var(--surface)", color: r.iterations > 1 ? "var(--purple)" : "var(--text-subtle)", fontVariantNumeric: "tabular-nums" }}>
                            ×{r.iterations}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                        {r.response_time_ms != null ? `${r.response_time_ms}ms` : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center", whiteSpace: "nowrap" }}>
                        <CacheSourceBadge hit={r.cache_hit} semantic={r.semantic_cache_hit} />
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-subtle)", fontSize: 11, whiteSpace: "nowrap" }}>
                        {formatTimestamp(r.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Per-document breakdown ── */}
        {per_doc.length > 0 && (
          <div style={{ borderRadius: 16, overflow: "hidden", background: "var(--glass)", border: "1px solid var(--border)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px" }}>Per-Document Breakdown</p>
            </div>
            {per_doc.map((d, i) => (
              <div key={i} style={{ padding: "16px 20px", borderBottom: i < per_doc.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ color: "var(--accent)", flexShrink: 0 }}>{Ic.file}</div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{d.filename || "Unknown"}</p>
                      <p style={{ fontSize: 10.5, color: "var(--text-subtle)", marginTop: 2 }}>{d.total_queries} queries · avg {d.avg_ms}ms</p>
                    </div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  <div>
                    <p style={{ fontSize: 10, color: "var(--text-subtle)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>Faithfulness</p>
                    <GradientBar value={Number(d.faithfulness_pct) || 0} color1={(d.faithfulness_pct || 0) >= 80 ? "#10b981" : "#f87171"} color2={(d.faithfulness_pct || 0) >= 80 ? "#34d399" : "#fca5a5"} />
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: "var(--text-subtle)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>Context Precision</p>
                    <GradientBar value={Number(d.avg_context_pct) || 0} color1="var(--accent)" color2="var(--accent-2)" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
