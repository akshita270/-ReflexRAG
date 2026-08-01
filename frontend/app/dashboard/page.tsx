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

function StatCard({
  label,
  value,
  unit = "",
  color = "#0d9488",
}: {
  label: string;
  value: number | string;
  unit?: string;
  color?: string;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "#ffffff", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
    >
      <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#94a3b8" }}>
        {label}
      </p>
      <p className="text-2xl font-bold" style={{ color }}>
        {value}
        <span className="text-base font-normal ml-1" style={{ color: "#94a3b8" }}>
          {unit}
        </span>
      </p>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMetrics()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center" style={{ background: "#f1f5f9", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <p style={{ color: "#94a3b8" }}>Loading metrics...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-dvh items-center justify-center" style={{ background: "#f1f5f9", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <p style={{ color: "#dc2626" }}>{error || "Failed to load metrics"}</p>
      </div>
    );
  }

  const { stats, recent, per_doc } = data;
  const pipelineRuns =
    (stats.total_queries || 0) - (stats.exact_hits || 0) - (stats.semantic_hits || 0);

  return (
    <div
      className="min-h-dvh"
      style={{ background: "#f1f5f9", fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Header */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0" }}>
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3" style={{ textDecoration: "none" }}>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                style={{ background: "#f0fdfa", border: "1px solid #99f6e4" }}
              >
                🧠
              </div>
              <span className="font-bold text-base" style={{ color: "#0f172a" }}>
                ReflexRAG
              </span>
            </Link>
            <span style={{ color: "#e2e8f0" }}>›</span>
            <span className="font-semibold" style={{ color: "#0d9488" }}>
              Eval Dashboard
            </span>
          </div>
          <Link
            href="/"
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{
              background: "#f0fdfa",
              border: "1px solid #99f6e4",
              color: "#0d9488",
              textDecoration: "none",
            }}
          >
            ← Back to Chat
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Total Queries" value={stats.total_queries || 0} color="#0f172a" />
          <StatCard
            label="Faithfulness"
            value={stats.faithfulness_pct || 0}
            unit="%"
            color={(stats.faithfulness_pct || 0) >= 80 ? "#15803d" : "#dc2626"}
          />
          <StatCard
            label="Relevance"
            value={stats.relevance_pct || 0}
            unit="%"
            color={(stats.relevance_pct || 0) >= 80 ? "#15803d" : "#dc2626"}
          />
          <StatCard label="Cache Hit Rate" value={stats.cache_hit_pct || 0} unit="%" color="#7c3aed" />
          <StatCard
            label="Avg Response"
            value={Math.round(stats.avg_response_ms || 0)}
            unit="ms"
            color="#0369a1"
          />
          <StatCard
            label="Context Precision"
            value={stats.avg_context_pct || 0}
            unit="%"
            color="#0d9488"
          />
        </div>

        {/* Cache breakdown */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "#ffffff", border: "1px solid #e2e8f0" }}
        >
          <p className="text-sm font-semibold mb-4" style={{ color: "#0f172a" }}>
            Cache Breakdown
          </p>
          <div className="flex gap-10">
            <div>
              <p className="text-xs mb-1" style={{ color: "#94a3b8" }}>
                Exact Cache Hits
              </p>
              <p className="text-2xl font-bold" style={{ color: "#7c3aed" }}>
                {stats.exact_hits || 0}
              </p>
              <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                identical query
              </p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: "#94a3b8" }}>
                Semantic Cache Hits
              </p>
              <p className="text-2xl font-bold" style={{ color: "#7c3aed" }}>
                {stats.semantic_hits || 0}
              </p>
              <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                similar meaning (≥92%)
              </p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: "#94a3b8" }}>
                Full Pipeline Runs
              </p>
              <p className="text-2xl font-bold" style={{ color: "#0d9488" }}>
                {pipelineRuns}
              </p>
              <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                RAG + reflection
              </p>
            </div>
          </div>
        </div>

        {/* Recent queries table */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "#ffffff", border: "1px solid #e2e8f0" }}
        >
          <div className="px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
            <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>
              Recent Queries
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                  {["Query", "Document", "Faithful", "Relevant", "Context", "Time", "Cache"].map((h) => (
                    <th
                      key={h}
                      className={`py-3 font-semibold ${h === "Query" || h === "Document" ? "text-left px-6" : "text-center px-4"}`}
                      style={{ color: "#64748b" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-center px-6 py-10"
                      style={{ color: "#94a3b8" }}
                    >
                      No queries yet — start chatting with a document.
                    </td>
                  </tr>
                ) : (
                  recent.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td
                        className="px-6 py-3"
                        style={{ color: "#1e293b", maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {r.query}
                      </td>
                      <td
                        className="px-6 py-3"
                        style={{ color: "#64748b", maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {r.filename || "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span style={{ color: r.faithful ? "#15803d" : "#dc2626", fontWeight: 600 }}>
                          {r.faithful ? "✓" : "✗"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span style={{ color: r.relevant ? "#15803d" : "#dc2626", fontWeight: 600 }}>
                          {r.relevant ? "✓" : "✗"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center" style={{ color: "#64748b" }}>
                        {r.context_precision != null
                          ? `${Math.round(r.context_precision * 100)}%`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-center" style={{ color: "#64748b" }}>
                        {r.response_time_ms != null ? `${r.response_time_ms}ms` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.cache_hit ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ background: "#f3e8ff", color: "#7c3aed" }}
                          >
                            exact
                          </span>
                        ) : r.semantic_cache_hit ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ background: "#ede9fe", color: "#6d28d9" }}
                          >
                            semantic
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ background: "#f0fdfa", color: "#0d9488" }}
                          >
                            pipeline
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-document breakdown */}
        {per_doc.length > 0 && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "#ffffff", border: "1px solid #e2e8f0" }}
          >
            <div className="px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
              <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>
                Per-Document Breakdown
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                    {["Document", "Queries", "Faithfulness", "Context Precision", "Avg Response"].map((h) => (
                      <th
                        key={h}
                        className={`py-3 font-semibold ${h === "Document" ? "text-left px-6" : "text-center px-4"}`}
                        style={{ color: "#64748b" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {per_doc.map((d, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td className="px-6 py-3 font-medium" style={{ color: "#1e293b" }}>
                        {d.filename || "Unknown"}
                      </td>
                      <td className="px-4 py-3 text-center" style={{ color: "#64748b" }}>
                        {d.total_queries}
                      </td>
                      <td
                        className="px-4 py-3 text-center font-medium"
                        style={{ color: (d.faithfulness_pct || 0) >= 80 ? "#15803d" : "#dc2626" }}
                      >
                        {d.faithfulness_pct}%
                      </td>
                      <td className="px-4 py-3 text-center" style={{ color: "#64748b" }}>
                        {d.avg_context_pct}%
                      </td>
                      <td className="px-4 py-3 text-center" style={{ color: "#64748b" }}>
                        {d.avg_ms}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
