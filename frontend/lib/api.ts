import type { UploadResponse, ChatResponse } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://reflexrag.com";

export async function uploadPDF(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/upload`, { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
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

export async function restoreSession(session_id: string): Promise<UploadResponse> {
  const res = await fetch(`${API_URL}/restore/${session_id}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Restore failed");
  }
  return res.json();
}
