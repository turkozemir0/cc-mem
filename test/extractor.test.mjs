/**
 * CMC Extractor — test suite
 * Run: node --test test/extractor.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  packagesFromCommand,
  extractTasks,
  heuristicDecisions,
  heuristicProblems,
  detectTechFromText,
  stackFromPackageJson,
  parseExistingState,
  mergeState,
  renderCMCBlock,
  deduplicateBySubstring,
  stripCode,
  sentences,
  CMC_START,
  CMC_END,
} from '../dist/core/extractor.js';

// ── packagesFromCommand ────────────────────────────────────────────────────
describe('packagesFromCommand', () => {
  test('npm install single package', () => {
    assert.deepEqual(packagesFromCommand('npm install react'), ['react']);
  });

  test('npm install multiple packages', () => {
    assert.deepEqual(packagesFromCommand('npm install react react-dom next'), ['react', 'react-dom', 'next']);
  });

  test('strips version suffix', () => {
    assert.deepEqual(packagesFromCommand('npm install react@18'), ['react']);
  });

  test('strips scoped package version', () => {
    assert.deepEqual(packagesFromCommand('npm install @supabase/supabase-js@2.0.0'), ['@supabase/supabase-js']);
  });

  test('skips flags', () => {
    assert.deepEqual(packagesFromCommand('npm install --save-dev typescript'), ['typescript']);
  });

  test('yarn add', () => {
    assert.deepEqual(packagesFromCommand('yarn add tailwindcss'), ['tailwindcss']);
  });

  test('bun add', () => {
    assert.deepEqual(packagesFromCommand('bun add hono'), ['hono']);
  });

  test('pnpm install', () => {
    assert.deepEqual(packagesFromCommand('pnpm install drizzle-orm'), ['drizzle-orm']);
  });

  test('pip install', () => {
    assert.deepEqual(packagesFromCommand('pip install fastapi'), ['fastapi']);
  });

  test('pip3 install', () => {
    assert.deepEqual(packagesFromCommand('pip3 install uvicorn'), ['uvicorn']);
  });

  test('non-install command returns empty', () => {
    assert.deepEqual(packagesFromCommand('npm run build'), []);
  });

  test('git command returns empty', () => {
    assert.deepEqual(packagesFromCommand('git commit -m "fix"'), []);
  });

  test('multiline command uses first line only', () => {
    assert.deepEqual(
      packagesFromCommand('npm install prisma\nnpm install @prisma/client'),
      ['prisma'],
    );
  });
});

// ── extractTasks ───────────────────────────────────────────────────────────
describe('extractTasks', () => {
  test('extracts open tasks', () => {
    const { open } = extractTasks('- [ ] Set up CI/CD\n- [ ] Add tests');
    assert.deepEqual(open, ['Set up CI/CD', 'Add tests']);
  });

  test('extracts done tasks', () => {
    const { done } = extractTasks('- [x] Fix auth bug\n- [X] Add login page');
    assert.deepEqual(done, ['Fix auth bug', 'Add login page']);
  });

  test('mixed open and done', () => {
    const text = '- [ ] Write docs\n- [x] Deploy to Vercel\n- [ ] Add dark mode';
    const { open, done } = extractTasks(text);
    assert.deepEqual(open, ['Write docs', 'Add dark mode']);
    assert.deepEqual(done, ['Deploy to Vercel']);
  });

  test('ignores non-task lines', () => {
    const { open, done } = extractTasks('## Heading\nSome text\n- regular bullet');
    assert.equal(open.length, 0);
    assert.equal(done.length, 0);
  });

  test('handles asterisk bullet', () => {
    const { open } = extractTasks('* [ ] Add pagination');
    assert.deepEqual(open, ['Add pagination']);
  });

  test('trims task text', () => {
    const { open } = extractTasks('- [ ]   Trim whitespace   ');
    assert.deepEqual(open, ['Trim whitespace']);
  });
});

// ── heuristicDecisions ────────────────────────────────────────────────────
describe('heuristicDecisions', () => {
  test('detects "chose" decision', () => {
    const texts = ['We chose Supabase over Firebase because of the PostgreSQL support.'];
    const result = heuristicDecisions(texts);
    assert.ok(result.length > 0, 'should find a decision');
    assert.ok(result[0].includes('Supabase'));
  });

  test('detects "decided" decision', () => {
    const texts = ['We decided to use tRPC for end-to-end type safety.'];
    const result = heuristicDecisions(texts);
    assert.ok(result.length > 0);
  });

  test('detects "switched" decision', () => {
    const texts = ['We switched from Prisma to Drizzle for better performance.'];
    const result = heuristicDecisions(texts);
    assert.ok(result.length > 0);
  });

  test('does NOT pick up random text with "use"', () => {
    // "use" alone no longer triggers — requires specific verbs
    const texts = ['You can use this function to get the user.'];
    const result = heuristicDecisions(texts);
    assert.equal(result.length, 0);
  });

  test('does NOT pick up Turkish imperative (düzelt ≠ düzelttik)', () => {
    const texts = ['Önce bug\'ı düzelt, sonra CLAUDE.md\'yi güncelle.'];
    const result = heuristicDecisions(texts);
    assert.equal(result.length, 0);
  });

  test('Turkish — detects seçtik (we chose)', () => {
    const texts = ['Supabase\'i seçtik çünkü PostgreSQL desteği daha iyi.'];
    assert.ok(heuristicDecisions(texts).length > 0);
  });

  test('Turkish — detects değiştirdik (we switched)', () => {
    const texts = ['Prisma\'dan Drizzle\'a değiştirdik, performans daha iyi oldu.'];
    assert.ok(heuristicDecisions(texts).length > 0);
  });

  test('French — detects choisi (chose)', () => {
    const texts = ['Nous avons choisi Supabase pour son support PostgreSQL natif.'];
    assert.ok(heuristicDecisions(texts).length > 0);
  });

  test('German — detects entschieden (decided)', () => {
    const texts = ['Wir haben uns für Supabase entschieden wegen der PostgreSQL-Unterstützung.'];
    assert.ok(heuristicDecisions(texts).length > 0);
  });

  test('Spanish — detects elegimos (we chose)', () => {
    const texts = ['Elegimos Supabase sobre Firebase por el soporte de PostgreSQL.'];
    assert.ok(heuristicDecisions(texts).length > 0);
  });

  test('Portuguese — detects escolhemos (we chose)', () => {
    const texts = ['Escolhemos Supabase pelo suporte nativo ao PostgreSQL.'];
    assert.ok(heuristicDecisions(texts).length > 0);
  });

  test('Japanese — detects 選びました (chose)', () => {
    const texts = ['Supabaseを選びました、PostgreSQLのサポートが優れているためです。'];
    assert.ok(heuristicDecisions(texts).length > 0);
  });

  test('Chinese — detects 选择了 (chose)', () => {
    const texts = ['我们选择了Supabase，因为它有更好的PostgreSQL支持。'];
    assert.ok(heuristicDecisions(texts).length > 0);
  });

  test('returns empty for empty input', () => {
    assert.deepEqual(heuristicDecisions([]), []);
  });

  test('limits to 3 decisions', () => {
    const texts = [
      'We chose React over Vue for the ecosystem.',
      'We opted for Tailwind over CSS modules.',
      'We selected Vercel over Netlify for Next.js integration.',
      'We preferred Drizzle over Prisma for performance.',
    ];
    const result = heuristicDecisions(texts);
    assert.ok(result.length <= 3);
  });
});

// ── heuristicProblems ─────────────────────────────────────────────────────
describe('heuristicProblems', () => {
  test('detects "fixed the null error"', () => {
    const texts = ['We fixed the null error by checking the session in middleware.'];
    const result = heuristicProblems(texts);
    assert.ok(result.length > 0, 'should detect problem');
  });

  test('detects "resolved the bug"', () => {
    const texts = ['I resolved the bug by adding a null check before accessing user.id.'];
    const result = heuristicProblems(texts);
    assert.ok(result.length > 0);
  });

  test('does NOT pick up "fix the bug" (imperative, not resolved)', () => {
    // "fix" (present tense) without "fixed/resolved" should NOT match
    const texts = ['Let me fix the bug in the auth function.'];
    const result = heuristicProblems(texts);
    assert.equal(result.length, 0, 'imperative "fix" should not match');
  });

  test('does NOT pick up Turkish imperative (düzelt ≠ düzelttik)', () => {
    const texts = ['Önce bug\'ı düzelt, sonra CLAUDE.md\'yi güncelle.'];
    assert.equal(heuristicProblems(texts).length, 0);
  });

  test('Turkish — detects düzelttik + hata (fixed the error)', () => {
    const texts = ['Middleware\'deki null hatasını düzelttik, session kontrolü ekledik.'];
    assert.ok(heuristicProblems(texts).length > 0);
  });

  test('Turkish — detects çözdük + bug', () => {
    const texts = ['Login\'deki bug\'ı çözdük, token yenileme eksikti.'];
    assert.ok(heuristicProblems(texts).length > 0);
  });

  test('French — detects corrigé + erreur', () => {
    const texts = ['Nous avons corrigé l\'erreur null dans le middleware d\'authentification.'];
    assert.ok(heuristicProblems(texts).length > 0);
  });

  test('German — detects behoben + bug', () => {
    const texts = ['Den Null-Pointer-Bug im Auth-Middleware wurde behoben.'];
    assert.ok(heuristicProblems(texts).length > 0);
  });

  test('Spanish — detects solucionamos + error', () => {
    const texts = ['Solucionamos el error null en el middleware de autenticación.'];
    assert.ok(heuristicProblems(texts).length > 0);
  });

  test('Japanese — detects 修正しました + エラー', () => {
    const texts = ['認証ミドルウェアのnullエラーを修正しました。'];
    assert.ok(heuristicProblems(texts).length > 0);
  });

  test('does NOT fire on problem word alone (no resolution)', () => {
    const texts = ['There is an error in the login flow that we need to look at.'];
    const result = heuristicProblems(texts);
    assert.equal(result.length, 0);
  });

  test('requires BOTH resolution AND problem words', () => {
    // "resolved" without a problem noun → no match
    const texts = ['We resolved the configuration by updating the env file.'];
    const result = heuristicProblems(texts);
    // "configuration" is not in PROBLEM_RE → should not match
    assert.equal(result.length, 0);
  });

  test('limits to 3 results', () => {
    const texts = [
      'Fixed the null error in the auth middleware.',
      'Resolved the crash bug when user logs out.',
      'Corrected the undefined issue in the dashboard.',
      'Fixed the exception in the API route handler.',
    ];
    assert.ok(heuristicProblems(texts).length <= 3);
  });
});

// ── stackFromPackageJson ──────────────────────────────────────────────────
describe('stackFromPackageJson', () => {
  test('maps known packages to labels', () => {
    const result = stackFromPackageJson({
      dependencies: { 'next': '^14', 'react': '^18', '@supabase/supabase-js': '^2' },
    });
    assert.ok(result.includes('Next.js'));
    assert.ok(result.includes('React'));
    assert.ok(result.includes('Supabase'));
  });

  test('reads devDependencies too', () => {
    const result = stackFromPackageJson({
      devDependencies: { 'typescript': '^5', 'drizzle-kit': '^0.29' },
    });
    assert.ok(result.includes('TypeScript'));
    assert.ok(result.includes('Drizzle'));
  });

  test('deduplicates same label from multiple packages', () => {
    // Both @supabase/supabase-js and @supabase/ssr → Supabase
    const result = stackFromPackageJson({
      dependencies: {
        '@supabase/supabase-js': '^2',
        '@supabase/ssr': '^0.3',
      },
    });
    assert.equal(result.filter(x => x === 'Supabase').length, 1);
  });

  test('reads Node.js from engines', () => {
    const result = stackFromPackageJson({
      engines: { node: '>=18' },
    });
    assert.ok(result.includes('Node.js'));
  });

  test('returns sorted array', () => {
    const result = stackFromPackageJson({
      dependencies: { 'react': '^18', 'next': '^14', 'tailwindcss': '^3' },
    });
    const sorted = [...result].sort();
    assert.deepEqual(result, sorted);
  });

  test('returns empty for empty package.json', () => {
    assert.deepEqual(stackFromPackageJson({}), []);
  });

  test('maps Transformers.js', () => {
    const result = stackFromPackageJson({
      dependencies: { '@xenova/transformers': '^2' },
    });
    assert.ok(result.includes('Transformers.js'));
  });
});

// ── detectTechFromText ────────────────────────────────────────────────────
describe('detectTechFromText', () => {
  test('finds Next.js mention', () => {
    assert.ok(detectTechFromText('We are building with Next.js and Tailwind').includes('Next.js'));
  });

  test('case insensitive', () => {
    assert.ok(detectTechFromText('using SUPABASE for auth').includes('Supabase'));
  });

  test('does not find partial matches (no word boundary issue)', () => {
    // "Reacted" should not match "React"
    const result = detectTechFromText('She reacted quickly to the issue.');
    assert.ok(!result.includes('React'));
  });

  test('returns empty for unrelated text', () => {
    const result = detectTechFromText('The cat sat on the mat.');
    assert.deepEqual(result, []);
  });
});

// ── parseExistingState ────────────────────────────────────────────────────
describe('parseExistingState', () => {
  const sampleBlock = `<!-- CMC:START -->
## 🧠 Project State

**Stack:** Next.js, TypeScript, Supabase

**Recent files** _(last 15)_:
- \`auth.ts\` — 2026-03-14
- \`page.tsx\` — 2026-03-13

**Open tasks:**
- [ ] Add dark mode
- [ ] Write tests

**Key decisions:**
- Chose Supabase over Firebase for PostgreSQL support

**Problems solved:**
- Fixed null error in middleware

<!-- CMC:END -->`;

  test('parses stack', () => {
    const state = parseExistingState(sampleBlock);
    assert.deepEqual(state.stack, ['Next.js', 'TypeScript', 'Supabase']);
  });

  test('parses files with dates', () => {
    const state = parseExistingState(sampleBlock);
    assert.equal(state.files.length, 2);
    assert.equal(state.files[0].path, 'auth.ts');
    assert.equal(state.files[0].date, '2026-03-14');
  });

  test('parses open tasks', () => {
    const state = parseExistingState(sampleBlock);
    assert.deepEqual(state.openTasks, ['Add dark mode', 'Write tests']);
  });

  test('parses decisions', () => {
    const state = parseExistingState(sampleBlock);
    assert.ok(state.decisions[0].includes('Supabase'));
  });

  test('parses problems', () => {
    const state = parseExistingState(sampleBlock);
    assert.ok(state.problems[0].includes('null'));
  });

  test('ignores placeholder text', () => {
    const block = `<!-- CMC:START -->
**Stack:** _Not detected yet._
**Key decisions:**
_None recorded yet._
<!-- CMC:END -->`;
    const state = parseExistingState(block);
    assert.deepEqual(state.stack, []);
    assert.deepEqual(state.decisions, []);
  });
});

// ── deduplicateBySubstring ────────────────────────────────────────────────
describe('deduplicateBySubstring', () => {
  test('keeps longer version when one contains the other', () => {
    const result = deduplicateBySubstring(['Email notifications', 'Email notifications (Resend)']);
    assert.equal(result.length, 1);
    assert.ok(result[0].includes('Resend'));
  });

  test('keeps both when unrelated', () => {
    const result = deduplicateBySubstring(['Add dark mode', 'Add pagination']);
    assert.equal(result.length, 2);
  });

  test('deduplicates case-insensitively', () => {
    const result = deduplicateBySubstring(['Email Notifications', 'email notifications (resend)']);
    assert.equal(result.length, 1);
  });

  test('preserves order (first item wins when equal length)', () => {
    const result = deduplicateBySubstring(['abc', 'xyz']);
    assert.equal(result.length, 2);
  });

  test('handles empty array', () => {
    assert.deepEqual(deduplicateBySubstring([]), []);
  });
});

// ── mergeState ────────────────────────────────────────────────────────────
describe('mergeState', () => {
  const emptyOld = { stack: [], files: [], openTasks: [], decisions: [], problems: [] };

  test('merges stack', () => {
    const result = mergeState(
      { ...emptyOld, stack: ['Next.js', 'React'] },
      { stack: ['TypeScript', 'React'], files: [], openTasks: [], doneTasks: [], decisions: [], problems: [] },
    );
    assert.ok(result.stack.includes('Next.js'));
    assert.ok(result.stack.includes('TypeScript'));
    assert.equal(result.stack.filter(x => x === 'React').length, 1);
  });

  test('removes done tasks from open list', () => {
    const result = mergeState(
      { ...emptyOld, openTasks: ['Write tests', 'Add dark mode'] },
      { stack: [], files: [], openTasks: [], doneTasks: ['Write tests'], decisions: [], problems: [] },
    );
    assert.ok(!result.openTasks.includes('Write tests'));
    assert.ok(result.openTasks.includes('Add dark mode'));
  });

  test('case-insensitive done task removal', () => {
    const result = mergeState(
      { ...emptyOld, openTasks: ['Write Tests'] },
      { stack: [], files: [], openTasks: [], doneTasks: ['write tests'], decisions: [], problems: [] },
    );
    assert.equal(result.openTasks.length, 0);
  });

  test('file date update — new date wins', () => {
    const result = mergeState(
      { ...emptyOld, files: [{ path: 'auth.ts', date: '2026-03-10' }] },
      { stack: [], files: [{ path: 'auth.ts', date: '2026-03-15' }], openTasks: [], doneTasks: [], decisions: [], problems: [] },
    );
    assert.equal(result.files.find(f => f.path === 'auth.ts')?.date, '2026-03-15');
    assert.equal(result.files.length, 1); // no duplicate
  });

  test('decisions: new ones prepended, max 5', () => {
    const oldDecisions = Array.from({ length: 4 }, (_, i) => `Old decision ${i}`);
    const result = mergeState(
      { ...emptyOld, decisions: oldDecisions },
      { stack: [], files: [], openTasks: [], doneTasks: [], decisions: ['New decision'], problems: [] },
    );
    assert.ok(result.decisions[0] === 'New decision');
    assert.ok(result.decisions.length <= 5);
  });

  test('files sorted most recent first', () => {
    const result = mergeState(
      { ...emptyOld, files: [{ path: 'old.ts', date: '2026-03-10' }] },
      { stack: [], files: [{ path: 'new.ts', date: '2026-03-15' }], openTasks: [], doneTasks: [], decisions: [], problems: [] },
    );
    assert.equal(result.files[0].path, 'new.ts');
  });

  test('files capped at MAX_FILES (15)', () => {
    const oldFiles = Array.from({ length: 15 }, (_, i) => ({ path: `file${i}.ts`, date: '2026-03-01' }));
    const result = mergeState(
      { ...emptyOld, files: oldFiles },
      { stack: [], files: [{ path: 'extra.ts', date: '2026-03-15' }], openTasks: [], doneTasks: [], decisions: [], problems: [] },
    );
    assert.equal(result.files.length, 15);
    // most recent should be in
    assert.ok(result.files.some(f => f.path === 'extra.ts'));
  });
});

// ── renderCMCBlock ────────────────────────────────────────────────────────
describe('renderCMCBlock', () => {
  const fullState = {
    stack:     ['Next.js', 'Supabase'],
    files:     [{ path: 'auth.ts', date: '2026-03-15' }],
    openTasks: ['Add dark mode'],
    decisions: ['Chose Supabase over Firebase'],
    problems:  ['Fixed null error in middleware'],
  };

  test('contains CMC markers', () => {
    const block = renderCMCBlock(fullState);
    assert.ok(block.includes(CMC_START));
    assert.ok(block.includes(CMC_END));
  });

  test('contains stack', () => {
    const block = renderCMCBlock(fullState);
    assert.ok(block.includes('Next.js, Supabase'));
  });

  test('contains file with date', () => {
    const block = renderCMCBlock(fullState);
    assert.ok(block.includes('`auth.ts` — 2026-03-15'));
  });

  test('contains open task', () => {
    const block = renderCMCBlock(fullState);
    assert.ok(block.includes('- [ ] Add dark mode'));
  });

  test('contains decision', () => {
    const block = renderCMCBlock(fullState);
    assert.ok(block.includes('Chose Supabase'));
  });

  test('contains problem', () => {
    const block = renderCMCBlock(fullState);
    assert.ok(block.includes('Fixed null error'));
  });

  test('uses placeholder when stack empty', () => {
    const block = renderCMCBlock({ ...fullState, stack: [] });
    assert.ok(block.includes('_Not detected yet._'));
  });

  test('uses placeholder when no tasks', () => {
    const block = renderCMCBlock({ ...fullState, openTasks: [] });
    assert.ok(block.includes('_No open tasks._'));
  });

  test('uses placeholder when no decisions', () => {
    const block = renderCMCBlock({ ...fullState, decisions: [] });
    assert.ok(block.includes('_None recorded yet._'));
  });

  test('rendered block is parseable by parseExistingState (round-trip)', () => {
    const block   = renderCMCBlock(fullState);
    const parsed  = parseExistingState(block);
    assert.deepEqual(parsed.stack,     fullState.stack);
    assert.deepEqual(parsed.openTasks, fullState.openTasks);
    assert.equal(parsed.files[0].path, fullState.files[0].path);
    assert.ok(parsed.decisions[0].includes('Supabase'));
    assert.ok(parsed.problems[0].includes('null'));
  });
});

// ── stripCode ─────────────────────────────────────────────────────────────
describe('stripCode', () => {
  test('removes fenced code blocks', () => {
    const result = stripCode('Text\n```js\nconst x = 1;\n```\nMore text');
    assert.ok(!result.includes('const x'));
    assert.ok(result.includes('Text'));
    assert.ok(result.includes('More text'));
  });

  test('removes inline code', () => {
    const result = stripCode('Use `npm install` to install');
    assert.ok(!result.includes('npm install'));
  });
});

// ── End-to-end: realistic session simulation ───────────────────────────────
describe('End-to-end: realistic session', () => {
  test('full pipeline on realistic assistant text', () => {
    const assistantTexts = [
      `I've set up the authentication system. We chose Supabase Auth over NextAuth because
       it integrates better with our PostgreSQL database and handles SSR seamlessly.`,

      `The middleware was failing because of a null error — I fixed the null error by adding
       a session guard before accessing user.id. The issue was that the session wasn't being
       refreshed properly on the server side.`,

      `Here are the remaining items:
       - [ ] Set up email notifications via Resend
       - [ ] Add rate limiting with Upstash Redis
       - [x] Fix authentication middleware`,
    ];

    const decisions = heuristicDecisions(assistantTexts);
    const problems  = heuristicProblems(assistantTexts);
    const { open, done } = extractTasks(assistantTexts.join('\n'));

    // Should find a decision about Supabase
    assert.ok(decisions.length > 0, 'should find decisions');
    assert.ok(decisions.some(d => /supabase/i.test(d)), 'should mention Supabase');

    // Should find the null error fix
    assert.ok(problems.length > 0, 'should find problems');
    assert.ok(problems.some(p => /null/i.test(p)), 'should mention null error');

    // Should find open tasks
    assert.ok(open.some(t => /Resend/i.test(t)));
    assert.ok(open.some(t => /Upstash/i.test(t)));

    // Should detect done task
    assert.ok(done.some(t => /auth/i.test(t)));

    // Full state merge
    const state = mergeState(
      { stack: [], files: [], openTasks: [], decisions: [], problems: [] },
      {
        stack:     ['Next.js', 'Supabase'],
        files:     [{ path: 'middleware.ts', date: '2026-03-15' }],
        openTasks: open,
        doneTasks: done,
        decisions,
        problems,
      },
    );

    // Render and round-trip
    const rendered = renderCMCBlock(state);
    assert.ok(rendered.includes(CMC_START));
    assert.ok(rendered.includes('Next.js'));
    assert.ok(rendered.includes('middleware.ts'));

    const reparsed = parseExistingState(rendered);
    assert.ok(reparsed.stack.includes('Next.js'));
    assert.ok(reparsed.files.some(f => f.path === 'middleware.ts'));
  });

  test('Turkish imperative forms do not pollute decisions or problems', () => {
    const assistantTexts = ['Hayır, şu an herhangi bir bug yok. Sistemi düzelt ve tekrar dene.'];
    assert.equal(heuristicDecisions(assistantTexts).length, 0, 'imperative düzelt is not a decision');
    assert.equal(heuristicProblems(assistantTexts).length,  0, 'imperative düzelt is not a fix');
  });

  test('Full Turkish session extracts correctly', () => {
    const assistantTexts = [
      'Auth sistemi için Supabase\'i seçtik çünkü PostgreSQL desteği daha iyi ve SSR ile uyumlu.',
      'Dashboard\'daki null hatasını düzelttik — middleware\'de session kontrolü eksikti.',
      'Yapılacaklar:\n- [ ] E-posta bildirimleri ekle\n- [x] Auth middleware düzeltildi',
    ];

    const decisions = heuristicDecisions(assistantTexts);
    const problems  = heuristicProblems(assistantTexts);
    const { open, done } = extractTasks(assistantTexts.join('\n'));

    assert.ok(decisions.length > 0, 'Turkish decision detected');
    assert.ok(decisions.some(d => /supabase/i.test(d)), 'mentions Supabase');
    assert.ok(problems.length > 0,  'Turkish problem detected');
    assert.ok(open.some(t => /e-posta/i.test(t)), 'Turkish task detected');
    assert.ok(done.length > 0, 'done task detected');
  });
});
