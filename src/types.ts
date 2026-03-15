export interface Message {
  role: 'human' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface Session {
  session_id: string;
  created_at: string;
  updated_at: string;
  source_file?: string;
  messages: Message[];
}

export interface Summary {
  summary_id: string;
  session_id: string;
  chunk_index: number;
  created_at: string;
  original_message_count: number;
  original_tokens: number;
  compressed_tokens: number;
  content: string; // structured markdown for display
}

export interface VectorEntry {
  id: string;
  summary_id: string;
  section: string;  // 'stack' | 'decisions' | 'problems' | 'tasks' | 'full'
  text: string;     // full summary markdown (for display in CLAUDE.md)
  embedding: number[];
}

export interface VectorStore {
  version: string;
  updated_at: string;
  entries: VectorEntry[];
}
