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

// ── Theme (same as main page) ─────────────────────────────────
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

// ── Components ────────────────────────────────────────────────

function StatCard({ label, value, unit = "", color = "var(--accent)", sub }: {
  label: string; value: number | string; unit?: string; color?: string; sub?: string;
}) {
  return (
    <div className="rounded-2xl p-5"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-subtle)" }}>
        {label}
      </p>
      <p className="text-2xl font-bold" style={{ color }}>
        {value}
        <span className="text-base font-normal ml-0.5" style={{ color: "var(--text-subtle)" }}>{unit}</span>
      </p>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--text-subtle)" }}>{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max = 100, color = "var(--accent)" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: "6px", background: "var(--border)" }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-medium w-10 text-right" style={{ color: "var(--text-muted)" }}>
        {value}%
      </span>
    </div>
  );
}

function CacheIndicator({ hit, semantic }: { hit: boolean; semantic: boolean }) {
  if (hit) return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: "var(--accent-light)", color: "var(--accent)" }}>⚡ exact</span>
  );
  if (semantic) return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: "var(--purple-bg)", color: "var(--purple)" }}>🔮 semantic</span>
  );
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: "var(--surface-alt)", color: "var(--text-subtle)" }}>🧠 pipeline</span>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function Dashboard() {
  const { isDark, toggle: toggleTheme } = useTheme();
  const [data, setData]     = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetchMetrics()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center" style={{ background: "var(--bg)" }}>
        <p style={{ color: "var(--text-subtle)" }}>Loading metrics...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-dvh items-center justify-center" style={{ background: "var(--bg)" }}>
        <p style={{ color: "var(--danger)" }}>{error || "Failed to load metrics"}</p>
      </div>
    );
  }

  const { stats, recent, per_doc } = data;
  const pipelineRuns = (stats.total_queries || 0) - (stats.exact_hits || 0) - (stats.semantic_hits || 0);

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>

      {/* Header */}
      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3" style={{ textDecoration: "none" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}>
                🧠
              </div>
              <span className="font-bold text-base" style={{ color: "var(--text)" }}>ReflexRAG</span>
            </Link>
            <span style={{ color: "var(--border)" }}>›</span>
            <span className="font-semibold text-sm" style={{ color: "var(--accent)" }}>Eval Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
              style={{ background: "var(--surface-alt)", border: "1px solid var(--border)" }}
              title="Toggle theme">
              {isDark ? "☀️" : "🌙"}
            </button>
            <Link href="/"
              className="text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)", textDecoration: "none" }}>
              ← Back to Chat
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Total Queries" value={stats.total_queries || 0} color="var(--text)" />
          <StatCard label="Faithfulness" value={stats.faithfulness_pct || 0} unit="%"
            color={(stats.faithfulness_pct || 0) >= 80 ? "var(--success)" : "var(--danger)"} />
          <StatCard label="Relevance" value={stats.relevance_pct || 0} unit="%"
            color={(stats.relevance_pct || 0) >= 80 ? "var(--success)" : "var(--danger)"} />
          <StatCard label="Cache Hit Rate" value={stats.cache_hit_pct || 0} unit="%" color="var(--purple)" />
          <StatCard label="Avg Response" value={Math.round(stats.avg_response_ms || 0)} unit="ms" color="var(--blue, #0369a1)" />
          <StatCard label="Context Precision" value={stats.avg_context_pct || 0} unit="%" color="var(--accent)" />
        </div>

        {/* Quality + Cache side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Quality bars */}
          <div className="rounded-2xl p-6"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <p className="text-sm font-semibold mb-5" style={{ color: "var(--text)" }}>Answer Quality</p>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span style={{ color: "var(--text-muted)" }}>Faithfulness</span>
                </div>
                <MiniBar value={Number(stats.faithfulness_pct) || 0}
                  color={(stats.faithfulness_pct || 0) >= 80 ? "var(--success)" : "var(--danger)"} />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span style={{ color: "var(--text-muted)" }}>Relevance</span>
                </div>
                <MiniBar value={Number(stats.relevance_pct) || 0}
                  color={(stats.relevance_pct || 0) >= 80 ? "var(--success)" : "var(--danger)"} />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span style={{ color: "var(--text-muted)" }}>Context Precision</span>
                </div>
                <MiniBar value={Number(stats.avg_context_pct) || 0} color="var(--accent)" />
              </div>
            </div>
          </div>

          {/* Cache breakdown */}
          <div className="rounded-2xl p-6"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <p className="text-sm font-semibold mb-5" style={{ color: "var(--text)" }}>Cache Breakdown</p>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>⚡ Exact Cache Hits</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-subtle)" }}>identical query</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{stats.exact_hits || 0}</p>
              </div>
              <div style={{ height: "1px", background: "var(--border)" }} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>🔮 Semantic Cache Hits</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-subtle)" }}>≥92% similar meaning</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: "var(--purple)" }}>{stats.semantic_hits || 0}</p>
              </div>
              <div style={{ height: "1px", background: "var(--border)" }} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>🧠 Full Pipeline Runs</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-subtle)" }}>RAG + self-reflection</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: "var(--text)" }}>{pipelineRuns}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent queries */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Recent Queries</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "var(--surface-alt)", borderBottom: "1px solid var(--border)" }}>
                  {["Query", "Document", "Faithful", "Relevant", "Context", "Time", "Source"].map(h => (
                    <th key={h}
                      className={`py-3 font-semibold ${h === "Query" || h === "Document" ? "text-left px-6" : "text-center px-4"}`}
                      style={{ color: "var(--text-subtle)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center px-6 py-10" style={{ color: "var(--text-subtle)" }}>
                      No queries yet — start chatting with a document.
                    </td>
                  </tr>
                ) : recent.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-6 py-3" style={{
                      color: "var(--text)", maxWidth: "260px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.query}
                    </td>
                    <td className="px-6 py-3" style={{
                      color: "var(--text-muted)", maxWidth: "140px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.filename || "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span style={{ color: r.faithful ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                        {r.faithful ? "✓" : "✗"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span style={{ color: r.relevant ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                        {r.relevant ? "✓" : "✗"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" style={{ color: "var(--text-muted)" }}>
                      {r.context_precision != null ? `${Math.round(r.context_precision * 100)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center" style={{ color: "var(--text-muted)" }}>
                      {r.response_time_ms != null ? `${r.response_time_ms}ms` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <CacheIndicator hit={r.cache_hit} semantic={r.semantic_cache_hit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-document breakdown */}
        {per_doc.length > 0 && (
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Per-Document Breakdown</p>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {per_doc.map((d, i) => (
                <div key={i} className="px-6 py-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{d.filename || "Unknown"}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-subtle)" }}>{d.total_queries} queries · avg {d.avg_ms}ms</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs mb-1.5" style={{ color: "var(--text-subtle)" }}>Faithfulness</p>
                      <MiniBar value={Number(d.faithfulness_pct) || 0}
                        color={(d.faithfulness_pct || 0) >= 80 ? "var(--success)" : "var(--danger)"} />
                    </div>
                    <div>
                      <p className="text-xs mb-1.5" style={{ color: "var(--text-subtle)" }}>Context Precision</p>
                      <MiniBar value={Number(d.avg_context_pct) || 0} color="var(--accent)" />
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
