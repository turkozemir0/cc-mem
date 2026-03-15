import { randomUUID } from 'crypto';
import ora from 'ora';
import chalk from 'chalk';
import type { Summary, VectorEntry } from '../types.js';
import {
  loadAllSessions,
  loadAllSummaries,
  saveSummary,
  loadVectorStore,
  saveVectorStore,
  ensureDirectories,
} from '../core/storage.js';
import { summarizeChunk, chunkMessages } from '../core/summarizer.js';
import { embedText } from '../core/embeddings.js';
import { estimateTokens } from '../utils/tokens.js';
import { log } from '../utils/logger.js';

export async function commandCompress(options: { force?: boolean }): Promise<void> {
  await ensureDirectories();
  log.header('⚡  CMC — Compress & Embed');

  const sessions = await loadAllSessions();
  if (sessions.length === 0) {
    log.warn('No sessions found. Run `cmc save <file>` first.');
    return;
  }

  const existing    = await loadAllSummaries();
  const doneKeys    = new Set(existing.map(s => `${s.session_id}:${s.chunk_index}`));
  const vectorStore = await loadVectorStore();

  let totalOriginal   = 0;
  let totalCompressed = 0;
  let newChunks       = 0;
  let newVectors      = 0;
  let embedMethod     = '';

  for (const session of sessions) {
    const chunks = chunkMessages(session.messages, 50);
    log.info(
      `Session ${chalk.cyan(session.session_id.slice(0, 8))}  →  ` +
      `${chunks.length} chunk(s), ${session.messages.length} messages`,
    );

    for (let i = 0; i < chunks.length; i++) {
      const key = `${session.session_id}:${i}`;

      if (!options.force && doneKeys.has(key)) {
        log.dim(`  [${i + 1}/${chunks.length}] already done (--force to redo)`);
        continue;
      }

      const chunk          = chunks[i];
      const originalTokens = chunk.reduce((s, m) => s + estimateTokens(m.content), 0);

      // ── Summarise ──────────────────────────────────────────────────
      const sumSpinner = ora(`  [${i + 1}/${chunks.length}] Summarising...`).start();
      const { markdown, sectionTexts, method: sumMethod } = await summarizeChunk(chunk);
      sumSpinner.succeed(
        `  [${i + 1}/${chunks.length}] Summary via ${chalk.magenta(sumMethod)} ` +
        `(${chalk.yellow(originalTokens.toLocaleString())} tokens)`,
      );

      const compressedTokens = estimateTokens(markdown);
      const summaryId        = randomUUID();

      await saveSummary({
        summary_id:             summaryId,
        session_id:             session.session_id,
        chunk_index:            i,
        created_at:             new Date().toISOString(),
        original_message_count: chunk.length,
        original_tokens:        originalTokens,
        compressed_tokens:      compressedTokens,
        content:                markdown,
      } satisfies Summary);

      // ── Embed each section separately ──────────────────────────────
      // stack, decisions, problems, tasks, full — 5 vectors per chunk.
      // Each vector stores the FULL markdown for display, but is indexed
      // by its section's prose text for better semantic matching.
      const embSpinner = ora(`  [${i + 1}/${chunks.length}] Embedding 5 sections...`).start();

      // Remove any stale vectors for this summary
      vectorStore.entries = vectorStore.entries.filter(e => e.summary_id !== summaryId);

      const sectionEntries = Object.entries(sectionTexts) as [string, string][];
      let method = '';

      for (const [section, sectionProseText] of sectionEntries) {
        if (!sectionProseText || sectionProseText.length < 10) continue;
        const { vector, method: m } = await embedText(sectionProseText);
        method = m;

        const entry: VectorEntry = {
          id:         randomUUID(),
          summary_id: summaryId,
          section,
          text:       markdown, // always store full summary for display
          embedding:  vector,
        };
        vectorStore.entries.push(entry);
        newVectors++;
      }

      embedMethod = method;
      embSpinner.succeed(
        `  [${i + 1}/${chunks.length}] Embedded ${sectionEntries.length} sections via ${chalk.blue(method)}  ` +
        `${chalk.yellow(originalTokens.toLocaleString())} → ${chalk.green(compressedTokens.toLocaleString())} tokens`,
      );

      totalOriginal   += originalTokens;
      totalCompressed += compressedTokens;
      newChunks++;
    }
  }

  await saveVectorStore(vectorStore);
  log.blank();

  if (newChunks === 0) {
    log.info('All chunks up to date. Use --force to re-process.');
    return;
  }

  if (embedMethod === 'hash') {
    log.warn('Using n-gram hash embeddings (ONNX unavailable). Semantic search still works.');
    log.dim('  Fix: npm rebuild sharp  (then run cmc compress --force)');
    log.blank();
  }

  const ratio = totalCompressed > 0
    ? (totalOriginal / totalCompressed).toFixed(1) : '∞';

  log.success(`Compressed ${newChunks} chunk(s) → ${newVectors} vectors.`);
  log.info(`  Original   : ${chalk.yellow(totalOriginal.toLocaleString())} tokens`);
  log.info(`  Compressed : ${chalk.green(totalCompressed.toLocaleString())} tokens`);
  log.info(`  Ratio      : ${chalk.bold.cyan(ratio + 'x')}`);
  log.blank();
  log.dim('Run `cmc recall "your query"` to inject context.');
}
