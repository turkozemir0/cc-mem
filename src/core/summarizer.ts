import type { Message } from '../types.js';

const OLLAMA_BASE  = 'http://localhost:11434';
const OLLAMA_MODEL = 'llama3';

// ── Ollama ────────────────────────────────────────────────────────────────

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function summarizeWithOllama(text: string): Promise<string> {
  const prompt = `You are a technical memory compressor.
Summarize this conversation into structured PROJECT MEMORY. Be concise but complete.

## STACK & ARCHITECTURE
- [list technologies, frameworks, key packages]

## KEY DECISIONS
- [important choices made with brief reasoning]

## PROBLEMS SOLVED
- [bugs or issues that were resolved, with the fix]

## CURRENT TASKS
- [ ] [pending or in-progress items]

## CONTEXT
- [other critical project facts]

CONVERSATION:
${text}

OUTPUT ONLY THE STRUCTURED MEMORY:`;

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:   OLLAMA_MODEL,
      prompt,
      stream:  false,
      options: { temperature: 0.1 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const json = await res.json() as { response: string };
  return json.response.trim();
}

// ── Keyword Fallback ───────────────────────────────────────────────────────

function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
    .replace(/^\s*[>#*-]+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]{15,}[.!?]/g) ?? []).map(s => s.trim());
}

const STOP = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','can',
  'to','of','in','for','on','with','at','by','from','as','it','this',
  'that','and','or','but','if','then','so','i','you','we','they','he',
  'she','my','your','our','their','just','also','not','no','use','used',
  'using','let','get','into','now','here','there','what','when','where',
  'which','its','about','more','some','all','one','two','three',
]);

function keywords(text: string, limit = 15): string[] {
  const freq: Record<string, number> = {};
  for (const w of (text.toLowerCase().match(/\b[a-z][a-z0-9_.-]{2,}\b/g) ?? [])) {
    if (!STOP.has(w)) freq[w] = (freq[w] ?? 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

function techs(text: string): string[] {
  const pats = [
    /\b(typescript|javascript|python|rust|go|java|swift|kotlin|dart)\b/gi,
    /\b(react|vue|angular|next\.?js|nuxt|svelte|solid|remix)\b/gi,
    /\b(node\.?js|deno|bun|express|fastify|koa|nest\.?js|hono)\b/gi,
    /\b(postgres|mysql|sqlite|mongodb|redis|supabase|prisma|drizzle|neon)\b/gi,
    /\b(docker|kubernetes|aws|gcp|azure|vercel|netlify|cloudflare)\b/gi,
    /\b(graphql|rest|trpc|grpc|websocket|realtime)\b/gi,
    /\b(tailwind|shadcn|chakra|radix|material.?ui)\b/gi,
    /\b(jest|vitest|playwright|cypress|testing.?library)\b/gi,
    /\b(ollama|openai|anthropic|claude|llm|langchain|rag|huggingface)\b/gi,
  ];
  const found = new Set<string>();
  for (const p of pats) for (const m of (text.match(p) ?? [])) found.add(m.toLowerCase());
  return [...found];
}

function filePaths(text: string): string[] {
  const m = text.match(/(?:^|[\s("`])([a-zA-Z0-9_/@.-]+\/[a-zA-Z0-9_.-]+\.[a-z]{1,5})/gm) ?? [];
  return [...new Set(m.map(s => s.trim().replace(/^[(`"]+/, '')))].slice(0, 8);
}

function decisions(assistantMsgs: string[]): string[] {
  const s = stripCode(assistantMsgs.join('\n'));
  return sentences(s)
    .filter(x => /\b(use|chose|decided|impl|switch|migrat|refactor|recommend|instead|better|prefer|replac)\b/i.test(x))
    .map(x => `- ${x.slice(0, 160)}`)
    .slice(0, 5);
}

function problems(messages: Message[]): string[] {
  const s = stripCode(messages.map(m => m.content).join('\n'));
  return sentences(s)
    .filter(x => /\b(fix(ed)?|resolv|error|bug|issue|problem|broken|fail|crash|cannot|undefined|null)\b/i.test(x))
    .map(x => `- ${x.slice(0, 160)}`)
    .slice(0, 5);
}

function tasks(messages: Message[]): string[] {
  const text = messages.map(m => m.content).join('\n');
  const boxes = (text.match(/^[-*]\s*\[[ x]\]\s*.{5,}/gm) ?? [])
    .map(t => t.trim().replace(/^[-*]\s*/, '- ').slice(0, 150));
  const stripped = stripCode(text);
  const hints = (stripped.match(
    /(?:^|\.\s+)(todo|need to|should|must|want to|next step|implement|add|create|set up)[^\n.!?]{8,}[.!?\n]/gim,
  ) ?? []).map(raw => {
    const c = raw.trim().replace(/^\.\s*/, '').replace(/^(todo|need to|should|must|want to|next step):?\s*/i, '');
    return `- [ ] ${c.slice(0, 140)}`;
  });
  return [...new Set([...boxes, ...hints])].slice(0, 8);
}

// ── Shared extraction helpers (used by both markdown builder and prose builder) ──

interface Extracted {
  techList:   string[];
  fileList:   string[];
  decList:    string[];
  probList:   string[];
  taskList:   string[];
  kwList:     string[];
  msgCount:   number;
  codeBlocks: number;
}

function extract(messages: Message[]): Extracted {
  const rawText = messages.map(m => m.content).join('\n');
  const stripped = stripCode(rawText);
  return {
    techList:   techs(rawText),
    fileList:   filePaths(rawText),
    decList:    decisions(messages.filter(m => m.role === 'assistant').map(m => m.content)),
    probList:   problems(messages),
    taskList:   tasks(messages),
    kwList:     keywords(stripped),
    msgCount:   messages.length,
    codeBlocks: Math.floor((rawText.match(/```/g) ?? []).length / 2),
  };
}

// ── Markdown summary (for CLAUDE.md display) ──────────────────────────────

function buildMarkdown(e: Extracted): string {
  return [
    '## STACK & ARCHITECTURE',
    e.techList.length ? `- Technologies: ${e.techList.join(', ')}` : '- (not detected)',
    e.fileList.length ? `- Key files: ${e.fileList.join(', ')}` : '',
    '',
    '## KEY DECISIONS',
    ...(e.decList.length ? e.decList : ['- (none detected)']),
    '',
    '## PROBLEMS SOLVED',
    ...(e.probList.length ? e.probList : ['- (none detected)']),
    '',
    '## CURRENT TASKS',
    ...(e.taskList.length ? e.taskList : ['- (none detected)']),
    '',
    '## CONTEXT',
    `- Key terms: ${e.kwList.join(', ')}`,
    `- Messages analysed: ${e.msgCount}` + (e.codeBlocks > 0 ? `, ${e.codeBlocks} code blocks` : ''),
  ].filter(l => l !== undefined).join('\n').trim();
}

// ── Section prose texts (for embedding — natural language embeds better) ──

export interface SectionTexts {
  stack:     string;
  decisions: string;
  problems:  string;
  tasks:     string;
  full:      string;
}

function buildSectionTexts(e: Extracted): SectionTexts {
  const stack = [
    e.techList.length ? `This project uses ${e.techList.slice(0, 8).join(', ')}.` : '',
    e.fileList.length ? `Key files include: ${e.fileList.join(', ')}.` : '',
  ].filter(Boolean).join(' ') || 'No technology stack detected.';

  const dec = e.decList.map(d => d.replace(/^-\s*/, '')).join(' ');
  const decisions = dec
    ? `Architectural decisions made: ${dec}`
    : 'No explicit architectural decisions detected.';

  const prob = e.probList.map(p => p.replace(/^-\s*/, '')).join(' ');
  const probs = prob
    ? `Issues and fixes: ${prob}`
    : 'No problems or bug fixes detected.';

  const task = e.taskList.map(t => t.replace(/^-\s*\[[x ]\]\s*/, '')).join(', ');
  const taskTxt = task
    ? `Pending work items: ${task}.`
    : 'No pending tasks detected.';

  const full = [stack, decisions, probs, taskTxt, `Topics covered: ${e.kwList.join(', ')}.`]
    .filter(Boolean).join(' ');

  return { stack, decisions: decisions, problems: probs, tasks: taskTxt, full };
}

// ── Public API ────────────────────────────────────────────────────────────

export interface SummaryResult {
  markdown:     string;
  sectionTexts: SectionTexts;
  method:       'ollama' | 'keywords';
}

export async function summarizeChunk(
  messages: Message[],
  useOllama = true,
): Promise<SummaryResult> {
  const e = extract(messages);
  const sectionTexts = buildSectionTexts(e);

  if (useOllama && await isOllamaRunning()) {
    try {
      const text = messages
        .map(m => `${m.role === 'human' ? 'Human' : 'Assistant'}: ${m.content.slice(0, 2000)}`)
        .join('\n\n---\n\n');
      const markdown = await summarizeWithOllama(text);
      // For Ollama output, build prose from the markdown sections
      return { markdown, sectionTexts, method: 'ollama' };
    } catch { /* fall through */ }
  }

  const markdown = buildMarkdown(e);
  return { markdown, sectionTexts, method: 'keywords' };
}

export function chunkMessages(messages: Message[], chunkSize = 50): Message[][] {
  const chunks: Message[][] = [];
  for (let i = 0; i < messages.length; i += chunkSize) chunks.push(messages.slice(i, i + chunkSize));
  return chunks;
}
