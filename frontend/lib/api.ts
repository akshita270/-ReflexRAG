import type { UploadResponse, ChatResponse } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://reflexrag.com";

export async function uploadPDF(
  file: File,
  onProgress?: (status: string) => void
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/upload`, { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Upload failed");
  }
  const { task_id, session_id, filename } = await res.json();

  // Poll task status until done
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${API_URL}/task/${task_id}`);
    const data = await poll.json();
    if (data.state === "SUCCESS") {
      return { session_id: data.session_id, chunk_count: data.chunk_count, filename: data.filename };
    }
    if (data.state === "FAILURE") {
      throw new Error(data.status || "Processing failed");
    }
    onProgress?.(data.status || "Processing...");
  }
}

export async function sendChat(session_id: string, query: string): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id, query }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Chat request failed");
  }
  return res.json();
}

export async function resetSession(session_id: string): Promise<void> {
  await fetch(`${API_URL}/session/${session_id}`, { method: "DELETE" });
}

export async function fetchSessions(): Promise<{ session_id: string; filename: string; chunk_count: number; created_at: string }[]> {
  const res = await fetch(`${API_URL}/sessions`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions || [];
}

export async function fetchMetrics() {
  const res = await fetch(`${API_URL}/metrics`);
  if (!res.ok) throw new Error("Failed to fetch metrics");
  return res.json();
}

export async function restoreSession(session_id: string): Promise<UploadResponse> {
  const res = await fetch(`${API_URL}/restore/${session_id}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Restore failed");
  }
  return res.json();
}
