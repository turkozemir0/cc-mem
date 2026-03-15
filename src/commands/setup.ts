import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const CLAUDE_DIR    = join(homedir(), '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const CMC_COMMAND   = 'cmc capture';

// ── Types for settings.json ───────────────────────────────────────────────
interface HookEntry {
  type: string;
  command: string;
}
interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}
interface ClaudeSettings {
  hooks?: {
    Stop?: HookMatcher[];
    [key: string]: HookMatcher[] | undefined;
  };
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function readSettings(): Promise<ClaudeSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw) as ClaudeSettings;
  } catch {
    return {};
  }
}

async function writeSettings(s: ClaudeSettings): Promise<void> {
  await fs.mkdir(CLAUDE_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
}

function isAlreadyInstalled(s: ClaudeSettings): boolean {
  return (s.hooks?.Stop ?? []).some(entry =>
    entry.hooks?.some(h => h.command?.includes(CMC_COMMAND)),
  );
}

// ── Install ───────────────────────────────────────────────────────────────
export async function commandSetup(): Promise<void> {
  log.header('⚙️   CMC — One-time Setup');

  const settings = await readSettings();

  if (isAlreadyInstalled(settings)) {
    log.success('Auto-capture hook already installed.');
    log.dim('  Every Claude Code session is automatically captured and compressed.');
    log.blank();
    log.dim('  To remove: cmc setup --remove');
    return;
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  settings.hooks.Stop.push({
    matcher: '',
    hooks: [{ type: 'command', command: CMC_COMMAND }],
  });

  await writeSettings(settings);

  log.success('Hook installed  →  ' + chalk.dim(SETTINGS_PATH));
  log.blank();
  log.info('What happens now:');
  log.info(`  ${chalk.cyan('1.')} You work in Claude Code as usual`);
  log.info(`  ${chalk.cyan('2.')} Session ends → CMC ${chalk.bold('auto-captures')} the transcript`);
  log.info(`  ${chalk.cyan('3.')} Context is compressed and ${chalk.bold('CLAUDE.md is updated')}`);
  log.info(`  ${chalk.cyan('4.')} Next session starts with full context already loaded`);
  log.blank();
  log.dim('Optional: run `cmc recall "topic"` to refine what context is injected.');
  log.blank();
  log.dim('To uninstall: cmc setup --remove');
}

// ── Remove ────────────────────────────────────────────────────────────────
export async function commandSetupRemove(): Promise<void> {
  const settings = await readSettings();

  if (!isAlreadyInstalled(settings)) {
    log.info('CMC hook is not installed. Nothing to remove.');
    return;
  }

  if (settings.hooks?.Stop) {
    settings.hooks.Stop = settings.hooks.Stop.filter(
      entry => !entry.hooks?.some(h => h.command?.includes(CMC_COMMAND)),
    );
    if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }

  await writeSettings(settings);
  log.success('CMC hook removed from ' + chalk.dim(SETTINGS_PATH));
}
