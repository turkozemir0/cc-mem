import chalk from 'chalk';
import { commandSave }     from './save.js';
import { commandCompress } from './compress.js';
import { commandRecall }   from './recall.js';
import { log }             from '../utils/logger.js';

/**
 * `cmc run <file> "query"` — convenience wrapper that chains:
 *   save → compress → recall
 * in a single command.
 */
export async function commandRun(
  file: string,
  query: string,
  options: { sessionId?: string; topK?: number; force?: boolean },
): Promise<void> {
  log.header('🚀  CMC — Full Pipeline');
  log.info(`File  : ${chalk.cyan(file)}`);
  log.info(`Query : ${chalk.cyan(`"${query}"`)}`);
  log.blank();

  await commandSave(file, { sessionId: options.sessionId });
  await commandCompress({ force: options.force });
  await commandRecall(query, { topK: options.topK });
}
