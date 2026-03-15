import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const CLAUDE_MD     = 'CLAUDE.md';
const CMC_START_TAG = '<!-- CMC:START -->';
const CMC_END_TAG   = '<!-- CMC:END -->';

const CMC_PLACEHOLDER =
  CMC_START_TAG + '\n' +
  '## 🧠 Project State\n\n' +
  '**Stack:** _Not detected yet._\n\n' +
  '**Recent files** _(last 15)_:\n_No files tracked yet._\n\n' +
  '**Open tasks:**\n_No open tasks._\n\n' +
  '**Key decisions:**\n_None recorded yet._\n\n' +
  '**Problems solved:**\n_None recorded yet._\n\n' +
  CMC_END_TAG;

export async function commandInit(): Promise<void> {
  log.header('🔧  CMC — Project Init');

  const claudePath = join(process.cwd(), CLAUDE_MD);

  let existing = '';
  try {
    existing = await fs.readFile(claudePath, 'utf8');
  } catch { /* file doesn't exist yet */ }

  if (existing.includes(CMC_START_TAG)) {
    log.info(`${CLAUDE_MD} already has a CMC memory section.`);
    log.dim('  Run `cmc recall "topic"` to update it.');
    return;
  }

  const content = existing.trimEnd()
    ? existing.trimEnd() + '\n\n' + CMC_PLACEHOLDER + '\n'
    : '# Project\n\nAdd your project instructions above this line.\n\n' + CMC_PLACEHOLDER + '\n';

  await fs.writeFile(claudePath, content, 'utf8');

  log.success(`${chalk.bold(CLAUDE_MD)} created/updated with CMC memory section.`);
  log.blank();
  log.info('You\'re all set. From here:');
  log.info(`  ${chalk.cyan('›')} Work in Claude Code as usual`);
  log.info(`  ${chalk.cyan('›')} Session ends → CLAUDE.md auto-updates (if you ran ${chalk.white('cmc setup')})`);
  log.info(`  ${chalk.cyan('›')} Next session starts with your project state already loaded`);
  log.blank();
  log.dim('Haven\'t run cmc setup yet?  →  cmc setup');
}
