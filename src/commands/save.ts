import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { Session, Message } from '../types.js';
import { saveSession, ensureDirectories } from '../core/storage.js';
import { log } from '../utils/logger.js';

// ── Format parsers ─────────────────────────────────────────────────────────

function parseJsonFormat(raw: string): Message[] | null {
  try {
    const data = JSON.parse(raw);
    // Support: { messages: [...] }, { chat: [...] }, or a bare array
    const msgs: { role?: string; content?: string }[] = Array.isArray(data)
      ? data
      : (data.messages ?? data.chat ?? null);
    if (!Array.isArray(msgs)) return null;

    return msgs
      .filter(m => m.role && m.content)
      .map(m => ({
        role:      (m.role === 'user' || m.role === 'human') ? 'human' : 'assistant',
        content:   String(m.content),
        timestamp: new Date().toISOString(),
      }));
  } catch {
    return null;
  }
}

function parseMarkdownFormat(raw: string): Message[] | null {
  if (!raw.match(/^## (Human|Assistant|User|Claude)/m)) return null;

  const messages: Message[] = [];
  const sections = raw.split(/^## (Human|Assistant|User|Claude)/m);

  for (let i = 1; i < sections.length; i += 2) {
    const roleStr = sections[i].trim().toLowerCase();
    const content = (sections[i + 1] ?? '').trim();
    if (content) {
      messages.push({
        role:      (roleStr === 'human' || roleStr === 'user') ? 'human' : 'assistant',
        content,
        timestamp: new Date().toISOString(),
      });
    }
  }
  return messages.length > 0 ? messages : null;
}

function parsePlainText(raw: string): Message[] {
  const messages: Message[] = [];
  const lines = raw.split('\n');
  let currentRole: 'human' | 'assistant' | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentRole && currentLines.length > 0) {
      const content = currentLines.join('\n').trim();
      if (content) messages.push({ role: currentRole, content, timestamp: new Date().toISOString() });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const humanMatch     = line.match(/^(Human|User|You|H):\s*(.*)/i);
    const assistantMatch = line.match(/^(Assistant|Claude|AI|A):\s*(.*)/i);

    if (humanMatch) {
      flush();
      currentRole = 'human';
      if (humanMatch[2]) currentLines.push(humanMatch[2]);
    } else if (assistantMatch) {
      flush();
      currentRole = 'assistant';
      if (assistantMatch[2]) currentLines.push(assistantMatch[2]);
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return messages;
}

// ── Command ────────────────────────────────────────────────────────────────

export async function commandSave(
  filePath: string,
  options: { sessionId?: string },
): Promise<void> {
  await ensureDirectories();
  log.header('📥  CMC — Save Conversation');

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    log.error(`Cannot read file: ${filePath}`);
    process.exit(1);
  }

  const messages =
    parseJsonFormat(raw) ??
    parseMarkdownFormat(raw) ??
    parsePlainText(raw);

  if (raw.trim().length === 0) {
    log.error(`File is empty: ${filePath}`);
    process.exit(1);
  }

  if (messages.length === 0) {
    log.error(
      'No messages found in file. Supported formats:\n' +
      '  • JSON        — { "messages": [{"role":"user","content":"..."}] }\n' +
      '  • Markdown    — ## Human / ## Assistant headings\n' +
      '  • Plain text  — "Human: ..." / "Assistant: ..." prefixes',
    );
    log.dim(`  File: ${filePath} (${raw.length} bytes)`);
    process.exit(1);
  }

  const session: Session = {
    session_id: options.sessionId ?? randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_file: filePath,
    messages,
  };

  await saveSession(session);

  log.success(`Session saved: ${session.session_id}`);
  log.info(`  Messages : ${messages.length}`);
  log.info(`  Source   : ${filePath}`);
  log.blank();
  log.dim('Run `cmc compress` to generate summaries and embeddings.');
}
