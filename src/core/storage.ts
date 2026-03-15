import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Session, Summary, VectorStore } from '../types.js';

export const CMC_DIR        = join(homedir(), '.cmc');
export const SESSIONS_DIR   = join(CMC_DIR, 'sessions');
export const SUMMARIES_DIR  = join(CMC_DIR, 'summaries');
export const MODELS_DIR     = join(CMC_DIR, 'models');
const VECTOR_STORE_PATH     = join(CMC_DIR, 'vectors.json');

export async function ensureDirectories(): Promise<void> {
  for (const dir of [CMC_DIR, SESSIONS_DIR, SUMMARIES_DIR, MODELS_DIR]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────

export async function saveSession(session: Session): Promise<void> {
  const path = join(SESSIONS_DIR, `${session.session_id}.json`);
  await fs.writeFile(path, JSON.stringify(session, null, 2), 'utf8');
}

export async function loadAllSessions(): Promise<Session[]> {
  await ensureDirectories();
  const files = await fs.readdir(SESSIONS_DIR);
  const sessions: Session[] = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(join(SESSIONS_DIR, file), 'utf8');
      sessions.push(JSON.parse(raw) as Session);
    } catch {
      console.warn(`  ⚠  Skipping damaged session file: ${file}`);
    }
  }
  return sessions;
}

// ── Summaries ─────────────────────────────────────────────────────────────

export async function saveSummary(summary: Summary): Promise<void> {
  const path = join(SUMMARIES_DIR, `${summary.summary_id}.json`);
  await fs.writeFile(path, JSON.stringify(summary, null, 2), 'utf8');
}

export async function loadAllSummaries(): Promise<Summary[]> {
  await ensureDirectories();
  const files = await fs.readdir(SUMMARIES_DIR);
  const summaries: Summary[] = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(join(SUMMARIES_DIR, file), 'utf8');
      summaries.push(JSON.parse(raw) as Summary);
    } catch {
      console.warn(`  ⚠  Skipping damaged summary file: ${file}`);
    }
  }
  return summaries;
}

// ── Vector Store ──────────────────────────────────────────────────────────

const EMPTY_STORE: VectorStore = { version: '1', updated_at: '', entries: [] };

export async function loadVectorStore(): Promise<VectorStore> {
  try {
    const raw = await fs.readFile(VECTOR_STORE_PATH, 'utf8');
    return JSON.parse(raw) as VectorStore;
  } catch {
    return { ...EMPTY_STORE, entries: [] };
  }
}

export async function saveVectorStore(store: VectorStore): Promise<void> {
  store.updated_at = new Date().toISOString();
  await fs.writeFile(VECTOR_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}
