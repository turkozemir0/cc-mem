/**
 * cmc capture
 *
 * Called automatically by the Claude Code Stop hook.
 * Orchestrates: transcript parsing → extraction → Ollama (optional) → CLAUDE.md update.
 * Always exits 0 — never blocks Claude Code.
 */

import { promises as fs }      from 'fs';
import { join }                from 'path';
import { homedir }             from 'os';

import {
  stackFromPackageJson,
  packagesFromCommand,
  extractTasks,
  heuristicDecisions,
  heuristicProblems,
  detectTechFromText,
  parseExistingState,
  mergeState,
  renderCMCBlock,
  CMC_START,
  CMC_END,
  type FileEntry,
  type ProjectState,
} from '../core/extractor.js';

// ── Hook payload ──────────────────────────────────────────────────────────
interface StopPayload {
  session_id?:       string;
  transcript_path?:  string;
  cwd?:              string;
  stop_hook_active?: boolean;
}

// ── Transcript types ───────────────────────────────────────────────────────
interface ToolUseBlock  { type: 'tool_use'; name: string; input: Record<string, unknown> }
interface TextBlock     { type: 'text'; text: string }
type ContentBlock = ToolUseBlock | TextBlock | { type: string };

interface TranscriptLine {
  type:     string;
  message?: { role: string; content: string | ContentBlock[] };
}

const FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

// ── Ollama ────────────────────────────────────────────────────────────────
const OLLAMA_URL = 'http://localhost:11434';

async function getOllamaModel(): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) return null;
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map(m => m.name);
    if (models.length === 0) return null;
    const preferred = [
      'llama3.2:1b','qwen2.5:0.5b','gemma2:2b',
      'llama3.2','llama3','mistral','gemma',
    ];
    for (const p of preferred) {
      const found = models.find(m => m.startsWith(p));
      if (found) return found;
    }
    return models[0];
  } catch { return null; }
}

async function ollamaSessionSummary(
  turns: Array<{ role: 'user' | 'assistant'; text: string }>,
  model: string,
): Promise<{ summary: string; decisions: string[]; problems: string[] } | null> {
  const convo = turns
    .map(t => {
      const label = t.role === 'user' ? 'Human' : 'Assistant';
      const text  = t.text
        .replace(/```[\s\S]{0,500}```/g, '[code]')
        .slice(0, 600);
      return `${label}: ${text}`;
    })
    .join('\n')
    .slice(-4_000);

  const prompt =
`Analyze this Claude Code session. Extract key information for the next session.

SESSION:
${convo}

Reply ONLY in this exact format. Use | to separate multiple items. Write "none" if nothing applies.
SUMMARY: <2-3 sentences: what was worked on, key context, current state, what comes next>
DECISIONS: <what was decided and why>
PROBLEMS: <bugs or errors that were fixed, with how>`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream:  false,
        options: { temperature: 0.1, num_predict: 200 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { response: string };
    const text = data.response;

    const m = /SUMMARY:\s*(.+)/i.exec(text);
    const summary = m ? m[1].trim() : '';
    if (!summary || summary.toLowerCase() === 'none') return null;

    const parseList = (key: string): string[] => {
      const km = new RegExp(`${key}:\\s*(.+)`, 'i').exec(text);
      if (!km || /^none$/i.test(km[1].trim())) return [];
      return km[1].split('|').map(s => s.trim()).filter(s => s.length > 5).slice(0, 3);
    };

    return { summary, decisions: parseList('DECISIONS'), problems: parseList('PROBLEMS') };
  } catch { return null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end',  () => resolve(data));
    process.stdin.on('error',() => resolve(''));
    setTimeout(() => resolve(data), 5_000);
  });
}

function textBlocks(content: string | ContentBlock[]): string[] {
  if (typeof content === 'string') return [content];
  return (content as ContentBlock[])
    .filter(b => b.type === 'text')
    .map(b => (b as TextBlock).text ?? '');
}

function toolUseBlocks(content: string | ContentBlock[]): ToolUseBlock[] {
  if (typeof content === 'string') return [];
  return (content as ContentBlock[]).filter(
    (b): b is ToolUseBlock => b.type === 'tool_use',
  );
}

async function readPkgStack(cwd: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(join(cwd, 'package.json'), 'utf8');
    return stackFromPackageJson(JSON.parse(raw));
  } catch { return []; }
}

async function updateCLAUDEMd(cwd: string, state: ProjectState): Promise<boolean> {
  const path = join(cwd, 'CLAUDE.md');
  let existing: string;
  try { existing = await fs.readFile(path, 'utf8'); }
  catch { return false; }
  if (!existing.includes(CMC_START)) return false;

  const si = existing.indexOf(CMC_START);
  const ei = existing.indexOf(CMC_END);
  if (ei === -1) return false;

  const before = existing.slice(0, si);
  const after  = existing.slice(ei + CMC_END.length);
  await fs.writeFile(path, before + renderCMCBlock(state) + after, 'utf8');
  return true;
}

async function appendLog(msg: string): Promise<void> {
  const p = join(homedir(), '.cmc', 'capture.log');
  await fs.appendFile(p, `[${new Date().toISOString()}] ${msg}\n`).catch(() => {});
}

// ── Entry point ───────────────────────────────────────────────────────────
export async function commandCapture(): Promise<void> {
  try {
    const raw = await readStdin();
    if (!raw.trim()) { process.exit(0); }

    let payload: StopPayload;
    try { payload = JSON.parse(raw) as StopPayload; }
    catch { process.exit(0); }

    if (payload.stop_hook_active) { process.exit(0); }
    const transcriptPath = payload.transcript_path;
    const cwd            = payload.cwd ?? process.cwd();
    if (!transcriptPath) { process.exit(0); }

    let transcriptRaw: string;
    try { transcriptRaw = await fs.readFile(transcriptPath, 'utf8'); }
    catch { process.exit(0); }

    const lines = transcriptRaw.split('\n').filter(l => l.trim());
    if (lines.length < 2) { process.exit(0); }

    // ── Parse transcript ────────────────────────────────────────────────
    const fileMap         = new Map<string, string>();
    const installedPkgs   = new Set<string>();
    const openTasks       = new Set<string>();
    const doneTasks       = new Set<string>();
    const assistantTexts: string[] = [];
    const allTexts:       string[] = [];
    const conversationTurns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    const dateStr = new Date().toISOString().slice(0, 10);

    for (const line of lines) {
      let obj: TranscriptLine;
      try { obj = JSON.parse(line) as TranscriptLine; } catch { continue; }
      if (obj.type !== 'user' && obj.type !== 'assistant') continue;
      const msg = obj.message;
      if (!msg?.content) continue;

      if (msg.role === 'assistant') {
        for (const b of toolUseBlocks(msg.content)) {
          if (FILE_WRITE_TOOLS.has(b.name)) {
            const fp = b.input.file_path as string | undefined;
            // Use basename as key to avoid path-format duplicates
            if (fp) {
              const name = fp.replace(/\\/g, '/').split('/').pop() ?? fp;
              fileMap.set(name, dateStr);
            }
          }
          if (b.name === 'Bash') {
            packagesFromCommand(b.input.command as string ?? '')
              .forEach(p => installedPkgs.add(p));
          }
        }
        for (const text of textBlocks(msg.content)) {
          const { open, done } = extractTasks(text);
          open.forEach(t => openTasks.add(t));
          done.forEach(t => doneTasks.add(t));
          assistantTexts.push(text);
          allTexts.push(text);
          conversationTurns.push({ role: 'assistant', text });
        }
      }

      if (msg.role === 'user') {
        for (const text of textBlocks(msg.content)) {
          allTexts.push(text);
          conversationTurns.push({ role: 'user', text });
        }
      }
    }

    // ── Stack ───────────────────────────────────────────────────────────
    const pkgStack  = await readPkgStack(cwd);
    const textStack = pkgStack.length === 0
      ? detectTechFromText(allTexts.join('\n'))
      : [];
    const stack = [...new Set([...pkgStack, ...textStack])].sort();

    // ── Heuristics ──────────────────────────────────────────────────────
    const hDecisions = heuristicDecisions(assistantTexts);
    const hProblems  = heuristicProblems(assistantTexts); // assistant-only

    // ── Ollama (optional) ───────────────────────────────────────────────
    let ollamaResult: { summary: string; decisions: string[]; problems: string[] } | null = null;
    const ollamaModel = await getOllamaModel();
    if (ollamaModel && conversationTurns.length > 0) {
      ollamaResult = await ollamaSessionSummary(conversationTurns, ollamaModel);
    }

    const decisions   = ollamaResult?.decisions.length ? ollamaResult.decisions : hDecisions;
    const problems    = ollamaResult?.problems.length  ? ollamaResult.problems  : hProblems;
    const lastSession = ollamaResult?.summary;

    // ── Load existing state ─────────────────────────────────────────────
    let oldState: ProjectState = { stack:[], files:[], openTasks:[], decisions:[], problems:[] };
    try {
      const existing = await fs.readFile(join(cwd, 'CLAUDE.md'), 'utf8');
      if (existing.includes(CMC_START)) oldState = parseExistingState(existing);
    } catch { /* no CLAUDE.md */ }

    const files: FileEntry[] = [...fileMap.entries()].map(([path, date]) => ({ path, date }));

    const newState = mergeState(oldState, {
      stack, files,
      openTasks: [...openTasks],
      doneTasks: [...doneTasks],
      decisions, problems, lastSession,
    });

    const updated = await updateCLAUDEMd(cwd, newState);

    await appendLog(
      `${updated ? 'updated' : 'skipped'} | ` +
      `files:${files.length} stack:${stack.length} ` +
      `tasks:${openTasks.size} decisions:${decisions.length} ` +
      `summary:${ollamaResult?.summary ? 'yes' : 'no'} ` +
      `method:${ollamaModel ? `ollama(${ollamaModel})` : 'heuristic'}`,
    );

  } catch (err) {
    await appendLog(`error: ${String(err)}`).catch(() => {});
  }

  process.exit(0);
}
