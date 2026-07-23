# CONTRIBUTING — the developer contract

> You are here because you are changing **the system's own code**. `CLAUDE.md` is the contract for
> *operating* the marketing system; this file is the contract for *building* it. They do not mix:
> there is no brief, no canon read, and no brand-guardian verdict for a TypeScript file.

## Setup

```bash
npm install
npx playwright install chromium
npm test
```

## The rules

1. **TDD, always.** Write the failing test, run it and watch it fail, write the minimum to pass, run
   it again, commit. A test you never saw fail is not a test.
2. **TypeScript strict.** No `any` without a comment explaining why it is unavoidable.
3. **Immutability.** Never mutate an object or array; return a new one.
4. **Small files.** 200-400 lines typical, 800 hard maximum. Split by responsibility.
5. **No emojis** in code, comments, or documentation.
6. **No secrets, ever.** Credentials come from environment variables. `.env` is gitignored;
   `.env.example` documents the keys and ships.
7. **Conventional commits:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.
8. **Commit per task**, not per session.

## Non-negotiable invariants

These encode the system's honesty claims. Breaking one silently turns the product into the thing it
was built to replace.

| Invariant | Where it lives | Why |
|---|---|---|
| Seeded outcomes can never enter the metric numerator | `src/metric/loop-closure.ts` | The honesty rule is arithmetic, not a promise. Do not add a code path around it. |
| A value of `0` is a measurement; `null` is not | `src/metric/loop-closure.ts` | Conflating them silently inflates the number. |
| Every generated page carries the not-official marker | `src/render/page.ts`, `src/verify/page.ts` | A live page in Base44's brand must never read as official. Verification fails without it. |
| Every artifact carries `card_id` in path, UTM and meta | `src/render/page.ts` | Attribution is a property of the artifact, not something reconstructed later. |
| Stub adapters return `[]` and never throw | `src/adapters/stubs.ts` | A missing key must degrade, never break the cold run. |
| Artifacts are derived, never hand-edited | `src/render/cli-build.ts` | Editing generated output severs the card-to-artifact link and breaks attribution. |

## Commands

| Command | What it does |
|---|---|
| `npm test` | Full suite |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | Types only, no emit |
| `npm run demo` | The 90-second demo, zero API keys |
| `npm run board` | Serve the board on :4174 |
| `npm run measure` | Pull outcomes through the adapters |
| `npm run verify:page -- <path>` | Playwright checks on a rendered page |

## The hooks are active while you work

`hooks/brand-lint.sh` and `hooks/design-lint.sh` run on every write. They are scoped to **content
paths only** (`content/**`, `build/pages/**`), so source code, tests, the canon, and documentation
are exempt. If a hook blocks a write you believe is legitimate, the scoping is wrong — fix the
scoping and add a test for it. Do not disable the hook.

## Layout

```
src/cards/      schema, store, reconciliation
src/metric/     surface registry and the loop-closure calculation
src/lint/       brand and design linters (pure functions + CLI wrappers)
src/render/     landing pages and social cards, from tokens only
src/verify/     Playwright verification
src/adapters/   the one Outcome contract and its implementations
src/board/      server, compute layer, UI
tests/          mirrors src/, plus tests/acceptance/ for the cold-clone test
```

## Before you open a PR

```bash
npm test && npm run typecheck && npm run demo
```

The cold-clone acceptance test (`tests/acceptance/cold-clone.test.ts`) is the one that matters most:
it proves a stranger can clone this repo with no credentials and watch the loop close.
