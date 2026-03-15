# 🧠 Claude Memory Compressor (CMC)

> **Your AI has a bad memory. CMC gives it a good one.**

[![npm version](https://img.shields.io/npm/v/claude-memory-compressor?color=cyan&style=flat-square)](https://www.npmjs.com/package/claude-memory-compressor)
[![Node.js ≥18](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![100% Local](https://img.shields.io/badge/runs-100%25%20local-orange?style=flat-square)](#how-it-works)

CMC automatically captures what happened in each Claude Code session and injects it back as structured context next time — **no API keys, no LLM required, no manual steps**.

---

## The Problem

Long Claude Code sessions hit a wall:
- 🔁 You re-explain the same architecture every new session
- 💸 Token costs rise as full history is re-sent
- 🤯 Claude forgets decisions made 50 messages ago

---

## The Solution

```
Session ends → CMC auto-captures → Extracts facts → Updates CLAUDE.md → Next session has full context
```

CMC hooks into Claude Code's Stop event and reads the session transcript directly. It extracts **structured facts** (files changed, packages installed, open tasks, tech stack, key decisions, problems solved) and merges them into `CLAUDE.md`.

| Mode | Context retention | How |
|---|---|---|
| **With Ollama** _(free, local)_ | **~95%** | Full session narrative — what was built, why, current state |
| **Without Ollama** | **~80%** | Files, tasks, stack, and key decisions captured deterministically |

Ollama runs 100% on your machine. No account, no API key, no data leaves your computer.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | [nodejs.org](https://nodejs.org) |
| Claude Code | Hooks into its Stop event |
| Ollama _(optional)_ | Richer semantic extraction. Free, local, no API key. |

### Install Ollama (optional but recommended)

Ollama runs AI models **100% on your machine**. No account, no API key, no data leaves your computer.

**macOS / Linux:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2
```

**Windows:**
Download from [ollama.ai](https://ollama.ai), then:
```bash
ollama pull llama3.2
```

> **Without Ollama:** CMC uses keyword heuristics. It still works well — Ollama just adds richer semantic extraction on top.

---

## Install

```bash
npm install -g claude-memory-compressor
```

Verify:
```bash
cmc --version
```

---

## Quick Start

### Step 1 — Install the auto-capture hook (once, global)
```bash
cmc setup
```
Registers a Claude Code Stop hook. Every session is captured automatically when it ends.

### Step 2 — Initialize your project (once per project)
```bash
cd your-project
cmc init
```
Adds a CMC state section to `CLAUDE.md`. Claude Code reads this on every session start.

### Step 3 — Work normally
```
[Claude Code session]
> You work as usual

[Session ends automatically]
> CMC reads the transcript
> Extracts: files changed, tech stack, open tasks, decisions, bugs fixed
> Updates CLAUDE.md — deterministic extraction, no information loss

[Next session]
> Claude reads CLAUDE.md
> Already knows what you worked on, which files changed, what's pending
> You never re-explain the context again
```

**No API keys. Works offline. Windows / macOS / Linux.**

---

## What Gets Captured

| Category | How it's detected |
|---|---|
| **Files changed** | `Edit`, `Write`, `NotebookEdit` tool calls in the transcript |
| **Packages installed** | `npm install`, `pip install`, `yarn add`, etc. in Bash calls |
| **Tech stack** | `package.json` dependencies → readable labels (60+ packages mapped) |
| **Open tasks** | `- [ ] …` checkboxes in assistant messages |
| **Completed tasks** | `- [x] …` checkboxes in assistant messages |
| **Key decisions** | Sentences with decision verbs: *chose, decided, switched, migrated…* |
| **Problems solved** | Sentences with resolution verbs + problem nouns: *fixed the bug, resolved the error…* |

### Multilingual support

CMC detects decisions and problems in **9+ languages**:

| Language | Decision words | Resolution words |
|---|---|---|
| English | chose, decided, switched… | fixed, resolved, solved… |
| Turkish | seçtik, değiştirdik, geçtik… | düzelttik, çözdük… |
| French | choisi, décidé, migré… | corrigé, résolu… |
| German | gewählt, entschieden… | behoben, gelöst… |
| Spanish | elegimos, decidimos… | solucionamos, corregimos… |
| Portuguese | escolhemos, decidimos… | corrigimos, resolvemos… |
| Italian | scelto, deciso… | risolto, corretto… |
| Japanese | 選びました, 決めました… | 修正しました, 解決しました… |
| Chinese | 选择了, 决定了… | 修复了, 解决了… |

---

## How It Works

```
Claude Code session ends
        │
        ▼
CMC Stop hook fires
        │
        ▼
Read JSONL transcript
        │
        ├─ tool_use: Edit/Write → files changed
        ├─ tool_use: Bash → npm install → packages
        └─ text blocks → tasks, decisions, problems
        │
        ▼
Read package.json → map to readable stack labels
        │
        ▼
Optional: ask Ollama for richer extraction
        │
        ▼
Merge with existing CLAUDE.md state
        │
        ▼
Write updated <!-- CMC:START --> block
```

### Extraction is deterministic

- Files come directly from tool call inputs — exact paths, no inference
- Packages come directly from bash commands — exact names
- Tasks come from `- [ ]` / `- [x]` markdown syntax — no ambiguity
- Decisions/problems use past-tense verb matching — false positives minimized

### Optional Ollama enhancement

If Ollama is running on `localhost:11434`, CMC auto-detects it and sends the session to a local model for richer semantic extraction. Prefers the smallest available model (`llama3.2:1b`, `qwen2.5:0.5b`, etc.) to stay fast.

---

## CLAUDE.md Output

After a session, your `CLAUDE.md` gets a block like:

```markdown
<!-- CMC:START -->
## 🧠 Project State

**Stack:** Next.js, React, Supabase, TypeScript, Tailwind CSS

**Recent files** _(last 15)_:
- `app/dashboard/page.tsx` — 2026-03-15
- `lib/db/schema.ts` — 2026-03-15
- `components/auth/login-form.tsx` — 2026-03-15

**Open tasks:**
- [ ] Add image upload for post content
- [ ] Set up CI/CD pipeline

**Key decisions:**
- Chose Supabase over Planetscale for built-in auth and realtime
- Switched from pages router to app router for better layouts

**Problems solved:**
- Fixed "Cannot read properties of null" on dashboard — middleware was not refreshing the session
<!-- CMC:END -->
```

---

## Where Data Is Stored

Everything is local:

```
~/.cmc/
└── capture.log    # capture audit log
```

The transcript files are read from Claude Code's own storage — CMC never copies or stores them.

---

## Troubleshooting

**`CLAUDE.md` not updating after session ends**
Run `cmc init` in your project directory first — the file must have a `<!-- CMC:START -->` marker.

**Decisions/problems section empty**
CMC only captures past-tense verbs from assistant messages. If the session had no explicit decisions or bug fixes described, the section stays empty.

**Ollama not being used**
CMC checks `localhost:11434` at session end. Make sure Ollama is running and has at least one model pulled.

**Wrong stack detected**
CMC reads `package.json` as the primary source. If there's no `package.json`, it falls back to text scanning. Make sure your project has a `package.json`.

---

## Advanced Commands

CMC also includes manual commands for one-off use:

### `cmc recall "<query>"`
Search past sessions and inject relevant context into `CLAUDE.md`.

```bash
cmc recall "authentication and JWT"
cmc recall "database migrations" --top-k 5
```

### `cmc run <file> <query>`
Manually save + compress + recall in one step.

```bash
cmc run session.md "what we built today"
```

### `cmc save <file>`
Manually ingest a conversation log (JSON, Markdown, or plain text).

### `cmc compress`
Rebuild the vector index from all saved sessions.

### `cmc stats`
Show token savings and storage statistics.

---

## Development

```bash
git clone https://github.com/turkozemir0/claude-memory-compressor
cd claude-memory-compressor
npm install
npm test          # 91 tests, Node.js built-in runner
npm run build
npm link          # test as global cmc command
```

---

## License

MIT — contributions welcome.

---

<p align="center">
  <b>Stop re-explaining your codebase. Let CMC remember it.</b>
</p>
