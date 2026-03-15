import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadVectorStore, ensureDirectories } from '../core/storage.js';
import { embedText } from '../core/embeddings.js';
import { search } from '../core/vectorSearch.js';
import type { SearchResult } from '../core/vectorSearch.js';
import { log } from '../utils/logger.js';

const CONTEXT_FILE  = '.claude-context.md';
const CLAUDE_MD     = 'CLAUDE.md';
const CMC_START_TAG = '<!-- CMC:START -->';
const CMC_END_TAG   = '<!-- CMC:END -->';

// ── Dedup results by summary_id ───────────────────────────────────────────
// Each chunk has 5 section vectors. When multiple sections from the same
// summary match, keep only the best-scoring one and show the full summary.
interface DeduplicatedResult {
  summary_id: string;
  bestScore:  number;
  bestSection: string;
  text:        string; // full summary markdown
}

function deduplicateResults(results: SearchResult[]): DeduplicatedResult[] {
  const map = new Map<string, DeduplicatedResult>();
  for (const r of results) {
    const existing = map.get(r.summary_id);
    if (!existing || r.score > existing.bestScore) {
      map.set(r.summary_id, {
        summary_id:  r.summary_id,
        bestScore:   r.score,
        bestSection: r.section,
        text:        r.text,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.bestScore - a.bestScore);
}

// ── Context file ──────────────────────────────────────────────────────────

function buildContext(query: string, results: DeduplicatedResult[]): string {
  const lines = [
    `<!-- CMC — query: "${query}" | updated: ${new Date().toISOString()} -->`,
    '',
    '# 🧠 Project Memory',
    '',
    `> **Query:** \`${query}\`  `,
    `> **Matched:** ${results.length} session(s)`,
    '',
    '---',
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r   = results[i];
    const pct = (r.bestScore * 100).toFixed(0);
    const sec = r.bestSection !== 'full' ? ` via ${r.bestSection}` : '';
    lines.push(`## Memory ${i + 1}  _(relevance: ${pct}%${sec})_`);
    lines.push('');
    lines.push(r.text);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('_End of injected memory._');
  return lines.join('\n');
}

// ── CLAUDE.md injection ───────────────────────────────────────────────────

async function injectIntoCLAUDEMd(cwd: string, context: string): Promise<boolean> {
  const path = join(cwd, CLAUDE_MD);
  let existing = '';
  try { existing = await fs.readFile(path, 'utf8'); }
  catch { return false; }
  if (!existing.includes(CMC_START_TAG)) return false;

  const before = existing.slice(0, existing.indexOf(CMC_START_TAG));
  const after  = existing.slice(existing.indexOf(CMC_END_TAG) + CMC_END_TAG.length);
  const block  =
    CMC_START_TAG + '\n' +
    '## 🧠 Project Memory (CMC)\n\n' +
    context + '\n' +
    CMC_END_TAG;

  await fs.writeFile(path, before + block + after, 'utf8');
  return true;
}

// ── Command ───────────────────────────────────────────────────────────────

export async function commandRecall(
  query: string,
  options: { topK?: number; output?: string },
): Promise<void> {
  await ensureDirectories();
  log.header('🔍  CMC — Recall Memory');

  const topK       = options.topK ?? 3;
  const contextOut = options.output ?? join(process.cwd(), CONTEXT_FILE);

  const vectorStore = await loadVectorStore();
  if (vectorStore.entries.length === 0) {
    log.warn('Vector store is empty. Run `cmc compress` first.');
    return;
  }

  log.info(
    `Searching ${vectorStore.entries.length} vector(s) ` +
    `for: ${chalk.cyan(`"${query}"`)}`,
  );

  const spinner    = ora('Embedding query...').start();
  const { vector } = await embedText(query);
  spinner.text     = 'Searching...';

  // Fetch more candidates than topK because we'll deduplicate by summary_id
  const rawResults = search(vector, vectorStore.entries, topK * 5);
  const results    = deduplicateResults(rawResults).slice(0, topK);

  spinner.succeed(`Found ${chalk.bold(String(results.length))} relevant session(s).`);

  if (results.length === 0) {
    log.warn('No relevant memory found. Try a broader query or run `cmc compress` again.');
    return;
  }

  log.blank();
  for (let i = 0; i < results.length; i++) {
    const r      = results[i];
    const filled = Math.round(r.bestScore * 10);
    const bar    = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(10 - filled));
    const sec    = r.bestSection !== 'full' ? chalk.dim(` [${r.bestSection}]`) : '';
    log.info(`  [${i + 1}] ${bar}  ${(r.bestScore * 100).toFixed(1)}%${sec}`);
  }

  const context = buildContext(query, results);
  await fs.writeFile(contextOut, context, 'utf8');
  log.blank();
  log.success(`Context file  → ${chalk.bold(contextOut)}`);

  const injected = await injectIntoCLAUDEMd(process.cwd(), context);
  if (injected) {
    log.success(`CLAUDE.md     → ${chalk.bold(join(process.cwd(), CLAUDE_MD))} ${chalk.green('(updated)')}`);
  } else {
    log.warn(`Run ${chalk.cyan('cmc init')} once to enable automatic CLAUDE.md injection.`);
  }
}
