#!/usr/bin/env node

// ── Node version guard ────────────────────────────────────────────────────
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(
    `\n  ✖  CMC requires Node.js ≥ 18. You are running v${process.versions.node}.\n` +
    `     Download the latest LTS: https://nodejs.org\n`,
  );
  process.exit(1);
}

import { Command } from 'commander';
import chalk from 'chalk';
import { commandSetup, commandSetupRemove } from './commands/setup.js';
import { commandCapture }  from './commands/capture.js';
import { commandInit }     from './commands/init.js';
import { commandSave }     from './commands/save.js';
import { commandCompress } from './commands/compress.js';
import { commandRecall }   from './commands/recall.js';
import { commandStats }    from './commands/stats.js';
import { commandRun }      from './commands/run.js';

const VERSION = '0.3.0';

// ── Global error handler ──────────────────────────────────────────────────
process.on('uncaughtException', (err: Error) => {
  const msg = err.message ?? String(err);

  if (msg.includes('ENOSPC')) {
    console.error(chalk.red('\n  ✖  No disk space left.') + ' Free up space and try again.\n');
  } else if (msg.includes('EACCES') || msg.includes('EPERM')) {
    console.error(chalk.red('\n  ✖  Permission denied.') + ` Cannot write to: ${(err as NodeJS.ErrnoException).path ?? 'unknown path'}\n`);
  } else if (msg.includes('ENOENT')) {
    console.error(chalk.red('\n  ✖  File not found:') + ` ${(err as NodeJS.ErrnoException).path ?? msg}\n`);
  } else if (msg.includes('fetch') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
    console.error(
      chalk.red('\n  ✖  Network error.') +
      ' Cannot download embedding model.\n' +
      '     Make sure you have internet access for the first run.\n' +
      '     Models are cached in ~/.cmc/models/ after that.\n',
    );
  } else {
    console.error(chalk.red('\n  ✖  Unexpected error:'), msg, '\n');
    if (process.env.DEBUG) console.error(err.stack);
    else console.error(chalk.dim('     Set DEBUG=1 for stack trace.\n'));
  }
  process.exit(1);
});

// ── Banner ────────────────────────────────────────────────────────────────
function printBanner(): void {
  console.log(
    '\n' +
    chalk.bold.cyan('  CMC') + '  ' +
    chalk.white('Claude Memory Compressor') + '  ' +
    chalk.dim(`v${VERSION}`) +
    '\n',
  );
}

// ── CLI ───────────────────────────────────────────────────────────────────
const program = new Command();

program
  .name('cmc')
  .description('Compress Claude Code conversation history with 100% local embeddings')
  .version(VERSION)
  .hook('preAction', () => printBanner());

// ── cmc setup ─────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Install the Claude Code Stop hook for automatic session capture (run once globally)')
  .option('--remove', 'Uninstall the hook')
  .action(async (opts: { remove?: boolean }) => {
    if (opts.remove) await commandSetupRemove();
    else             await commandSetup();
  });

// ── cmc capture (called by the Stop hook — not for manual use) ────────────
program
  .command('capture')
  .description('Process a Claude Code session transcript (called automatically by the Stop hook)')
  .addHelpText('after', '\n  This command is called automatically. You do not need to run it manually.')
  .action(async () => { await commandCapture(); });

// ── cmc init ──────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Add a CMC memory section to CLAUDE.md in the current project (run once per project)')
  .action(async () => { await commandInit(); });

program
  .command('save <file>')
  .description('Ingest a chat log file (JSON, Markdown, or plain text)')
  .option('-s, --session-id <id>', 'Custom session ID')
  .action(async (file: string, opts: { sessionId?: string }) => {
    await commandSave(file, opts);
  });

program
  .command('compress')
  .description('Compress sessions and build section-level vector index')
  .option('-f, --force', 'Re-process already compressed chunks')
  .action(async (opts: { force?: boolean }) => { await commandCompress(opts); });

program
  .command('recall <query>')
  .description('Search vector memory and inject context into CLAUDE.md')
  .option('-k, --top-k <n>', 'Number of sessions to retrieve', '3')
  .option('-o, --output <path>', 'Output file path (default: ./.claude-context.md)')
  .action(async (query: string, opts: { topK?: string; output?: string }) => {
    await commandRecall(query, {
      topK:   opts.topK ? parseInt(opts.topK, 10) : 3,
      output: opts.output,
    });
  });

program
  .command('stats')
  .description('Show compression metrics and token savings')
  .action(async () => { await commandStats(); });

program
  .command('run <file> <query>')
  .description('Full pipeline in one command: save → compress → recall')
  .option('-s, --session-id <id>', 'Custom session ID')
  .option('-k, --top-k <n>', 'Number of sessions to retrieve', '3')
  .option('-f, --force', 'Force re-compression')
  .action(async (file: string, query: string, opts: { sessionId?: string; topK?: string; force?: boolean }) => {
    await commandRun(file, query, {
      sessionId: opts.sessionId,
      topK:      opts.topK ? parseInt(opts.topK, 10) : 3,
      force:     opts.force,
    });
  });

program.parse();
