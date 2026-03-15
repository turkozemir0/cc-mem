/**
 * Pure extraction, parsing, and merging logic for CMC capture.
 * No I/O — fully testable.
 */

import { basename } from 'path';

// ── Types ─────────────────────────────────────────────────────────────────
export interface FileEntry   { path: string; date: string }
export interface ProjectState {
  stack:     string[];
  files:     FileEntry[];
  openTasks: string[];
  decisions: string[];
  problems:  string[];
}
export interface SessionFacts {
  stack:     string[];
  files:     FileEntry[];
  openTasks: string[];
  doneTasks: string[];
  decisions: string[];
  problems:  string[];
}

// ── Constants ─────────────────────────────────────────────────────────────
export const CMC_START     = '<!-- CMC:START -->';
export const CMC_END       = '<!-- CMC:END -->';
export const MAX_FILES     = 15;
export const MAX_DECISIONS = 5;
export const MAX_PROBLEMS  = 5;

// ── Package name → readable label ─────────────────────────────────────────
export const PACKAGE_LABEL_MAP: Record<string, string> = {
  // Frameworks
  'next':                        'Next.js',
  'react':                       'React',
  'react-dom':                   'React',
  'vue':                         'Vue',
  'svelte':                      'Svelte',
  '@angular/core':               'Angular',
  'nuxt':                        'Nuxt',
  'astro':                       'Astro',
  '@remix-run/node':             'Remix',
  '@remix-run/react':            'Remix',
  'solid-js':                    'SolidJS',
  // Languages / runtimes
  'typescript':                  'TypeScript',
  'bun-types':                   'Bun',
  // Backend
  'express':                     'Express',
  'fastify':                     'Fastify',
  'hono':                        'Hono',
  '@nestjs/core':                'NestJS',
  'koa':                         'Koa',
  'elysia':                      'Elysia',
  // Database / ORM
  'prisma':                      'Prisma',
  '@prisma/client':              'Prisma',
  'drizzle-orm':                 'Drizzle',
  'drizzle-kit':                 'Drizzle',
  'pg':                          'PostgreSQL',
  'postgres':                    'PostgreSQL',
  '@vercel/postgres':            'PostgreSQL',
  'mysql2':                      'MySQL',
  'better-sqlite3':              'SQLite',
  '@libsql/client':              'Turso',
  'mongoose':                    'MongoDB',
  'ioredis':                     'Redis',
  'redis':                       'Redis',
  '@upstash/redis':              'Upstash Redis',
  '@upstash/ratelimit':          'Upstash',
  '@neondatabase/serverless':    'Neon',
  'neon':                        'Neon',
  '@planetscale/database':       'PlanetScale',
  // BaaS
  '@supabase/supabase-js':       'Supabase',
  '@supabase/ssr':               'Supabase',
  '@supabase/auth-helpers-nextjs':'Supabase',
  'firebase':                    'Firebase',
  'firebase-admin':              'Firebase',
  // API
  '@trpc/server':                'tRPC',
  '@trpc/client':                'tRPC',
  'graphql':                     'GraphQL',
  '@apollo/server':              'Apollo',
  // Auth
  '@clerk/nextjs':               'Clerk',
  'next-auth':                   'NextAuth',
  '@auth/core':                  'Auth.js',
  'lucia':                       'Lucia',
  // Styling
  'tailwindcss':                 'Tailwind',
  '@shadcn/ui':                  'shadcn',
  '@radix-ui/react-dialog':      'Radix UI',
  '@chakra-ui/react':            'Chakra UI',
  'framer-motion':               'Framer Motion',
  // Payments / services
  'stripe':                      'Stripe',
  'resend':                      'Resend',
  '@sendgrid/mail':              'SendGrid',
  'twilio':                      'Twilio',
  // Infra / tooling
  'vite':                        'Vite',
  'webpack':                     'Webpack',
  'esbuild':                     'ESBuild',
  'turbopack':                   'Turbopack',
  'vitest':                      'Vitest',
  'jest':                        'Jest',
  'playwright':                  '@playwright/test',
  '@playwright/test':            'Playwright',
  // AI / ML
  '@xenova/transformers':        'Transformers.js',
  'openai':                      'OpenAI',
  '@anthropic-ai/sdk':           'Anthropic SDK',
  'langchain':                   'LangChain',
  // CLI tools (CMC itself)
  'commander':                   'Commander',
  'chalk':                       'Chalk',
  'ora':                         'Ora',
};

// ── Tech keywords (text scan fallback) ───────────────────────────────────
export const TECH_KEYWORDS = [
  'Next.js','React','Vue','Svelte','Angular','Nuxt','Astro','Remix',
  'TypeScript','JavaScript','Python','Go','Rust','Java',
  'Supabase','Firebase','PostgreSQL','MySQL','SQLite','MongoDB','Redis',
  'Prisma','Drizzle','tRPC','GraphQL',
  'Tailwind','shadcn',
  'Vercel','Netlify','Railway','AWS','GCP','Azure','Docker',
  'Stripe','Resend','Clerk','Upstash','Neon','Turso',
  'Vite','Webpack','Node.js','Bun','Deno',
  'Transformers.js','OpenAI','LangChain',
];

// ── Package stack from package.json ──────────────────────────────────────
export function stackFromPackageJson(pkgJson: {
  dependencies?:    Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?:         Record<string, string>;
}): string[] {
  const all = new Set([
    ...Object.keys(pkgJson.dependencies    ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
  ]);
  const result = new Set<string>();
  for (const pkg of all) {
    const label = PACKAGE_LABEL_MAP[pkg];
    if (label) result.add(label);
  }
  // Infer runtime from engines field
  const engines = pkgJson.engines ?? {};
  if (engines['node']) result.add('Node.js');
  if (engines['bun'])  result.add('Bun');
  return [...result].sort();
}

// ── Install command extraction ────────────────────────────────────────────
const INSTALL_RE = /^(?:npm|yarn|bun|pnpm)\s+(?:install|add|i)\s+(.+)$/;
const PIP_RE     = /^pip(?:3)?\s+install\s+(.+)$/;

export function packagesFromCommand(cmd: string): string[] {
  const first = cmd.trim().split('\n')[0].replace(/\s+/g, ' ');
  const match  = INSTALL_RE.exec(first) ?? PIP_RE.exec(first);
  if (!match) return [];
  return match[1]
    .split(/\s+/)
    .filter(p => !p.startsWith('-') && p.length > 0)
    .map(p => {
      const at = p.startsWith('@') ? p.indexOf('@', 1) : p.indexOf('@');
      return at > 0 ? p.slice(0, at) : p;
    });
}

// ── Task extraction ───────────────────────────────────────────────────────
const OPEN_RE = /^[-*]\s+\[\s+\]\s+(.+)$/;
const DONE_RE = /^[-*]\s+\[x\]\s+(.+)$/i;

export function extractTasks(text: string): { open: string[]; done: string[] } {
  const open: string[] = [], done: string[] = [];
  for (const line of text.split('\n')) {
    const t  = line.trim();
    const om = OPEN_RE.exec(t);
    const dm = DONE_RE.exec(t);
    if (om) open.push(om[1].trim());
    else if (dm) done.push(dm[1].trim());
  }
  return { open, done };
}

// ── Text helpers ──────────────────────────────────────────────────────────
export function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '').trim();
}

export function sentences(text: string): string[] {
  // Normalize line breaks to spaces so multi-line sentences are captured
  const normalized = text.replace(/\n\s*/g, ' ');
  // Include CJK sentence-ending punctuation: 。！？
  return (normalized.match(/[^.!?。！？]{15,}[.!?。！？]/gu) ?? []).map(s => s.trim());
}

// ── Multilingual decision verbs ───────────────────────────────────────────
// Past-tense / completed decision verbs across major languages.
// Imperative forms (e.g. "fix", "düzelt") are intentionally excluded.
const DECISION_WORDS = [
  // English
  'chose','decided','switched','migrated','opted','replaced','preferred','selected',
  // Turkish
  'seçtik','seçildi','tercih ettik','tercih edildi','değiştirdik','geçtik','karar verdik',
  // French
  'choisi','décidé','opté','migré','remplacé','préféré','sélectionné','adopté',
  // German
  'entschieden','gewählt','optiert','migriert','ersetzt','bevorzugt','umgestellt','ausgewählt',
  // Spanish
  'elegimos','decidimos','optamos','migramos','reemplazamos','preferimos','seleccionamos',
  // Portuguese
  'escolhemos','decidimos','optamos','migramos','substituímos','preferimos','adotamos',
  // Italian
  'scelto','deciso','optato','migrato','sostituito','preferito','adottato',
  // Dutch
  'gekozen','besloten','overgestapt','gemigreerd','vervangen','verkozen',
  // Russian (Latin transliteration common in tech)
  'vybral','reshili','perekhod',
];

// CJK patterns (word boundaries don't apply)
const DECISION_CJK = /選びました|選択しました|決めました|決定しました|采用了|选择了|决定了|결정했|선택했/;

// Unicode-aware: (?<!\p{L}) instead of \b so accented/non-ASCII words match correctly
const DECISION_LATIN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${DECISION_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'iu',
);

export function heuristicDecisions(assistantTexts: string[]): string[] {
  const text = stripCode(assistantTexts.join('\n'));
  return sentences(text)
    .filter(s => DECISION_LATIN_RE.test(s) || DECISION_CJK.test(s))
    .map(s => s.slice(0, 140))
    .slice(0, 3);
}

// ── Multilingual resolution + problem words ───────────────────────────────
const RESOLUTION_WORDS = [
  // English — past tense only ("fix" imperative excluded)
  'fixed','resolved','corrected','solved','addressed',
  // Turkish
  'düzelttik','düzeltildi','çözdük','çözüldü','giderdik','hallettik','onarıldı',
  // French
  'corrigé','résolu','réparé','réglé','résoudre',
  // German
  'behoben','gelöst','repariert','korrigiert','gefixt',
  // Spanish
  'corregimos','solucionamos','arreglamos','resolvimos','corregido','solucionado',
  // Portuguese
  'corrigimos','resolvemos','consertamos','corrigido','resolvido',
  // Italian
  'corretto','risolto','sistemato','riparato',
  // Dutch
  'opgelost','gecorrigeerd','gerepareerd',
];

const RESOLUTION_CJK = /修正しました|解決しました|直しました|修复了|解决了|수정했|해결했/u;

const RESOLUTION_LATIN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${RESOLUTION_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'iu',
);

// Problem nouns: mostly English/code terms — universal in tech regardless of UI language
// Accented variants added for French/German/etc
const PROBLEM_WORDS = [
  'error','bug','issue','problem','crash','null','undefined','exception','failure',
  // Turkish
  'hata',
  // French
  'erreur',
  // German
  'fehler',
  // Dutch
  'fout',
  // Italian / Portuguese
  'errore','erro',
  // Spanish
  'problema',
];
const PROBLEM_LATIN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${PROBLEM_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'iu',
);
const PROBLEM_CJK = /バグ|エラー|問題|错误|问题|버그|에러/u;

export function heuristicProblems(assistantTexts: string[]): string[] {
  const text = stripCode(assistantTexts.join('\n'));
  return sentences(text)
    .filter(s =>
      (RESOLUTION_LATIN_RE.test(s) || RESOLUTION_CJK.test(s)) &&
      (PROBLEM_LATIN_RE.test(s)    || PROBLEM_CJK.test(s)),
    )
    .map(s => s.slice(0, 140))
    .slice(0, 3);
}

// ── Tech keyword scan (fallback) ──────────────────────────────────────────
export function detectTechFromText(text: string): string[] {
  return TECH_KEYWORDS.filter(kw =>
    new RegExp(`(?<![\\w-])${kw.replace('.', '\\.')}(?![\\w-])`, 'i').test(text),
  );
}

// ── Parse existing CMC block ──────────────────────────────────────────────
export function parseExistingState(cmcBlock: string): ProjectState {
  const state: ProjectState = {
    stack: [], files: [], openTasks: [], decisions: [], problems: [],
  };

  const stackMatch = /\*\*Stack:\*\*\s*(.+)/.exec(cmcBlock);
  if (stackMatch) {
    state.stack = stackMatch[1]
      .split(',')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('_'));
  }

  const fileRe = /^-\s+`(.+?)`\s+—\s+(\d{4}-\d{2}-\d{2})/gm;
  let fm: RegExpExecArray | null;
  while ((fm = fileRe.exec(cmcBlock)) !== null) {
    state.files.push({ path: fm[1], date: fm[2] });
  }

  const taskRe = /^-\s+\[\s+\]\s+(.+)$/gm;
  let tm: RegExpExecArray | null;
  while ((tm = taskRe.exec(cmcBlock)) !== null) state.openTasks.push(tm[1].trim());

  const parseListSection = (header: string): string[] => {
    const re = new RegExp(
      `\\*\\*${header}\\*\\*[\\s\\S]*?(?=\\n\\*\\*|<!-- CMC:END|$)`, 'i',
    );
    const m = re.exec(cmcBlock);
    if (!m) return [];
    return [...m[0].matchAll(/^-\s+(.+)$/gm)]
      .map(x => x[1].trim())
      .filter(x => !x.startsWith('_'));
  };
  state.decisions = parseListSection('Key decisions:');
  state.problems  = parseListSection('Problems solved:');

  return state;
}

// ── Deduplication ─────────────────────────────────────────────────────────
export function deduplicateBySubstring(items: string[]): string[] {
  const result: string[] = [];
  for (const candidate of items) {
    const cl = candidate.toLowerCase();
    // Skip if an existing entry is LONGER and already contains this candidate
    const dominated = result.some(e => e.toLowerCase().includes(cl));
    if (!dominated) {
      // Replace any SHORTER existing entry that this candidate supersedes
      const shorterIdx = result.findIndex(e => cl.includes(e.toLowerCase()));
      if (shorterIdx !== -1) result.splice(shorterIdx, 1);
      result.push(candidate);
    }
  }
  return result;
}

// ── Merge ─────────────────────────────────────────────────────────────────
export function mergeState(old: ProjectState, facts: SessionFacts): ProjectState {
  const stack = [...new Set([...old.stack, ...facts.stack])].sort();

  const fileMap = new Map<string, string>();
  for (const f of old.files)   fileMap.set(f.path, f.date);
  for (const f of facts.files) fileMap.set(f.path, f.date);
  const files = [...fileMap.entries()]
    .map(([path, date]) => ({ path, date }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_FILES);

  const doneSet   = new Set(facts.doneTasks.map(t => t.toLowerCase()));
  const rawTasks  = [...old.openTasks, ...facts.openTasks]
    .filter(t => !doneSet.has(t.toLowerCase()));
  const openTasks = deduplicateBySubstring(rawTasks);

  const decisions = deduplicateBySubstring([
    ...facts.decisions,
    ...old.decisions,
  ]).slice(0, MAX_DECISIONS);

  const problems = deduplicateBySubstring([
    ...facts.problems,
    ...old.problems,
  ]).slice(0, MAX_PROBLEMS);

  return { stack, files, openTasks, decisions, problems };
}

// ── Render ────────────────────────────────────────────────────────────────
export function renderCMCBlock(state: ProjectState): string {
  const stackLine = state.stack.length
    ? state.stack.join(', ')
    : '_Not detected yet._';

  const filesLines = state.files.length
    ? state.files.map(f => `- \`${f.path}\` — ${f.date}`).join('\n')
    : '_No files tracked yet._';

  const tasksLines = state.openTasks.length
    ? state.openTasks.map(t => `- [ ] ${t}`).join('\n')
    : '_No open tasks._';

  const decisionsLines = state.decisions.length
    ? state.decisions.map(d => `- ${d}`).join('\n')
    : '_None recorded yet._';

  const problemsLines = state.problems.length
    ? state.problems.map(p => `- ${p}`).join('\n')
    : '_None recorded yet._';

  return [
    CMC_START,
    '## 🧠 Project State',
    '',
    `**Stack:** ${stackLine}`,
    '',
    `**Recent files** _(last ${MAX_FILES})_:`,
    filesLines,
    '',
    '**Open tasks:**',
    tasksLines,
    '',
    '**Key decisions:**',
    decisionsLines,
    '',
    '**Problems solved:**',
    problemsLines,
    '',
    CMC_END,
  ].join('\n');
}
