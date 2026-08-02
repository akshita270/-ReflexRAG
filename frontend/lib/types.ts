export interface ReflectionEntry {
  iteration: number;
  expanded: boolean;
  retrieved: number;
  after_grading: number;
  faithful: boolean;
  relevant: boolean;
  reason: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  chunks?: string[];
  reflection_log?: ReflectionEntry[];
  source?: "pipeline" | "cache" | "semantic_cache";
  faithful?: boolean;
  relevant?: boolean;
  context_precision?: number;
  response_time_ms?: number;
  iterations?: number;
}

export interface UploadResponse {
  session_id: string;
  chunk_count: number;
  filename: string;
}

export interface ChatResponse {
  answer: string;
  chunks: string[];
  reflection_log: ReflectionEntry[];
  source?: "pipeline" | "cache" | "semantic_cache";
  faithful?: boolean;
  relevant?: boolean;
  context_precision?: number;
  response_time_ms?: number;
  iterations?: number;
}

