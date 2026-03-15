import chalk from 'chalk';
import {
  loadAllSessions,
  loadAllSummaries,
  loadVectorStore,
  CMC_DIR,
  ensureDirectories,
} from '../core/storage.js';
import { log } from '../utils/logger.js';

function row(label: string, value: string) {
  console.log(`  ${chalk.dim(label.padEnd(28))} ${chalk.bold(value)}`);
}

function divider(title: string) {
  console.log(chalk.cyan(`  ${'─'.repeat(46)}`));
  console.log(chalk.cyan(`  ${title}`));
  console.log(chalk.cyan(`  ${'─'.repeat(46)}`));
}

export async function commandStats(): Promise<void> {
  await ensureDirectories();
  log.header('📊  CMC — Statistics');

  const [sessions, summaries, vectorStore] = await Promise.all([
    loadAllSessions(),
    loadAllSummaries(),
    loadVectorStore(),
  ]);

  const totalMessages        = sessions.reduce((s, sess) => s + sess.messages.length, 0);
  const totalOriginalTokens  = summaries.reduce((s, sum) => s + sum.original_tokens, 0);
  const totalCompressedTokens = summaries.reduce((s, sum) => s + sum.compressed_tokens, 0);
  const compressionRatio     = totalCompressedTokens > 0
    ? (totalOriginalTokens / totalCompressedTokens).toFixed(1)
    : '—';

  divider('STORAGE');
  row('Location',          CMC_DIR);
  row('Sessions saved',    String(sessions.length));
  row('Messages stored',   totalMessages.toLocaleString());
  console.log();

  divider('COMPRESSION');
  row('Summaries generated', String(summaries.length));
  row('Vectors stored',      String(vectorStore.entries.length));
  row('Original tokens',     chalk.yellow(totalOriginalTokens.toLocaleString()));
  row('Compressed tokens',   chalk.green(totalCompressedTokens.toLocaleString()));
  row('Compression ratio',   chalk.bold.cyan(`${compressionRatio}x`));

  if (totalOriginalTokens > 0 && totalCompressedTokens > 0) {
    const saved    = totalOriginalTokens - totalCompressedTokens;
    const savedPct = ((saved / totalOriginalTokens) * 100).toFixed(0);
    // Rough Claude Sonnet pricing: ~$3 / 1M input tokens
    const savedUSD = ((saved / 1_000_000) * 3).toFixed(4);

    console.log();
    divider('ESTIMATED SAVINGS');
    row('Tokens saved',          chalk.green(`${saved.toLocaleString()} (${savedPct}%)`));
    row('Cost saved (Sonnet ~$3/1M)', chalk.green(`~$${savedUSD}`));
  }

  console.log(chalk.cyan(`  ${'─'.repeat(46)}`));
  log.blank();
}
