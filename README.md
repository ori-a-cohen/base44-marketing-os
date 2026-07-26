# Roundtrip

**A marketing system that grades itself on what it can prove.** Roundtrip forks Base44's
marketing-engineering starter and closes the loop the starter leaves open: approved copy becomes a
real landing page and a token-derived social card, every shipped piece comes back with a *measured*
result, and that result is attached to the exact brand rules that approved it.

The headline number is deliberately unflattering — **loop-closure rate**, reported as `N of M
measured` — and it starts at zero, because the original schema had no field for what happened after
publish. Producing more content without measuring it pushes the number *down*, never up.

**Live board:** https://roundtrip-board-ecceb49b.base44.app — hosted on Base44 as a real Base44 app,
showing the same honest number this repo computes locally.

> Runs cold with **zero API keys**. The whole loop closes against a local card store and a local
> visit logger — enforced by an acceptance test, not just claimed.

---

## What you can do with it

- **Launch a campaign end to end** — brief → on-brand copy → real HTML landing page + social card →
  automated verification → a scored quality gate → a tracked card on the board.
- **Enforce the brand at the filesystem** — off-brand words or off-token colours never reach disk.
  Two PreToolUse hooks block the write and hand the model back the exact rule it broke.
- **Measure what shipped** — pull outcomes through per-surface adapters and watch the loop-closure
  rate move, with seeded/immature/stale data structurally excluded from the numerator.
- **See the work, not just the score** — every campaign on the board opens in place to the copy that
  shipped, the platform it shipped on, a live preview of the rendered page, its live URL, and the raw
  measured result with its provenance — over a rule-accountability view that names which brand rules
  the outcome data does and doesn't support.
- **Extend honestly** — unconfigured ad surfaces (Meta, LinkedIn) are registered as real, loudly
  labelled stubs, not silent gaps; a hosted Base44 storage driver slots in behind the same contract
  as the local one.

---

## Get started

Requires **Node 20+**.

```bash
git clone https://github.com/ori-a-cohen/base44-marketing-os.git
cd base44-marketing-os
npm install
npx playwright install chromium   # for page verification
npm run demo                      # the 90-second, zero-key proof
npm run board                     # browse the result at http://127.0.0.1:4174
```

`npm run demo` (aka `bash scripts/demo.sh`) fetches the Geist font, seeds the starter's example cards
plus one approved card, builds its landing page and social card, verifies the rendered page in a real
headless browser, records a genuine local page visit, serves the board and confirms it answers — then
shuts itself down. It needs **no credentials**: `tests/acceptance/cold-clone.test.ts` runs the same
script from a clean state and asserts it completes with every optional key scrubbed.

Then `npm run board` serves the board at `http://127.0.0.1:4174`. **Campaigns** is the first thing you
see: one row per card across every status, each expanding in place to the copy that shipped
(headline, subhead, body, CTA and its destination), its links, a live preview of the generated page,
the raw measured value with its unit and provenance, and the full verdict and history trail. Below it
sit the per-surface breakdown and the diagnostics.

The demo's headline reads `1 of 1 measured (1 with an unreadable ship time)`. That is not a bug: one
of the starter's example cards claims it shipped without recording *when*, so it is excluded from the
denominator and named, rather than quietly counted as in flight. A shrinking denominator is never
allowed to be invisible.

The preview is a `sandbox=""` iframe. Every generated page reports its own page views, so an
unsandboxed frame would let the board manufacture the number it exists to measure. A preview is not a
visit — enforced twice (the sandbox, and the page's own top-frame check) and tested in a real browser
against the visits log, with a control case proving the beacon does fire on a direct load.

---

## How you actually run it

Roundtrip is operated through Claude Code — the `agents/` and `skills/` are the interface, the
`src/` code is the enforcement underneath them. A real campaign flows through one skill:

**`skills/launch-campaign/` — the orchestrator**

```
brief  →  writer  →  brand gate  →  build artifacts  →  verify  →  design gate  →  card + board  →  memory
```

1. **Brief.** Confirm channel, topic, audience, the one message, and the CTA. (`brand/audiences.md`
   defines the four segments; `data/source-base1.md` is the only factual ground — no invented claims.)
2. **Write** as `agents/writer.md`, which re-reads the canon before producing a word.
3. **Brand gate.** `agents/brand-guardian.md` scores the copy against every numbered rule in
   `brand/rules.md`; below the bar, it revises once, then escalates. The `brand-lint` hook has already
   made off-brand copy physically un-writable.
4. **Build.** `npx tsx src/render/cli-build.ts --card <cardId>` renders the landing page and social
   card from `brand/DESIGN.md` tokens only — never a remembered hex.
5. **Verify for free.** `npm run verify:page` runs the page through headless Chromium *before* any
   human or model looks at it (structure, tracking, mobile, the not-official marker).
6. **Design gate.** `agents/design-guardian.md` scores the rendered artifact against the numbered
   `DESIGN.md` rules. The `design-lint` hook has already blocked any off-token colour.
7. **Card + board.** Every guardian verdict becomes a card via the `reconcile` Stop hook — logging is
   structural, not something a run can skip.
8. **Measure later.** `skills/measure/` (`npm run measure`) pulls real outcomes and advances the
   card's state; `skills/rule-audit/` turns the accumulated outcomes into the accountability view.

You never hand-write a card or a number — the code assigns provenance and the metric, so the board
number is one nobody typed.

---

## The metric, in plain language

**Loop-closure rate — of everything published, how much do we actually know the result of?**

Four rules keep it honest, enforced in code (`src/metric/loop-closure.ts`), not by convention:

1. **Only real results count.** Seeded/sample data shows on the board, clearly marked, and can never
   enter the numerator — `COUNTING_PROVENANCES` excludes it structurally, not by review.
2. **Zero is an answer; unknown isn't.** A page that got no visitors is *measured* — the outcome
   exists and its value is `0`. A page nobody checked has no outcome row, and does not count.
3. **New work gets a grace period.** A card enters the denominator only after its surface's maturity
   window passes (15 min for a landing page, 1 hr for an answer-engine check, 1 day for an ad surface).
4. **Results go stale.** Past a surface's TTL, a stale measurement drops out of the numerator (it
   stays in the denominator) — walk away and the number drifts back down.

Always reported as **"3 of 4 measured"**, never a percentage — at small N a percentage lies in both
directions. The metric was hardened against every way to inflate it: duplicate/regenerated cards are
deduped to their latest version, pre-ship and post-TTL measurements are rejected, and per-surface
`closed` counts sum *exactly* to the headline.

---

## What's enforced vs. what's judged

Roundtrip is careful about the line between what a deterministic check can prove and what needs
human/model judgement — and it labels the difference instead of pretending.

| Concern | Enforced in code (blocks the write / fails the run) | Left to the guardian agent's judgement |
|---|---|---|
| Vocabulary | Banned words (`brand-lint`) — off-brand copy exits 2, never hits disk | Tone, rhetorical AI-tells (flagged as advisory `warn`, not blocked) |
| Colour | Any non-token hex/rgb/hsl, gradients, non-`none` shadows (`design-lint`) | Layout, hierarchy, whether it *looks* right |
| Page | One `h1`, one tracked CTA, the marker, no mobile overflow (`verify:page`) | Colour contrast, whether the intended font loaded (stated gaps, not silent) |
| Facts | Every claim must trace to `data/source-base1.md` | — |

Fonts are the model case: `brand/DESIGN.md` names **Dazzed** (display) and **Geist** (body). Geist is
SIL Open Font License, so `scripts/fetch-fonts.sh` downloads it into gitignored `assets/fonts/`.
Dazzed's licence forbids redistribution, so **it is never fetched or committed** — the renderer
resolves `Dazzed → Geist → system`, reports which face it used (`attributes.display_font`), and a
fallback is a labelled, visible seam on the board, never a silent substitution.

---

## The four layers

| Layer | Starter had | Roundtrip adds |
|---|---|---|
| **Brain** | `writer.md`, `brand-guardian.md`, a router | `designer`, `design-guardian`, `analyst` agents; `launch-campaign` / `measure` / `rule-audit` skills; numbered-per-rule verdicts |
| **Visibility** | `activity-log.md` — one line per run | The live board (`src/board/`) — every campaign with its copy, platform, live URL, preview and measured result, over the loop-closure number, per-surface scores and rule accountability |
| **Movement** | `hooks/log-run.sh` | `brand-lint` + `design-lint` (PreToolUse, block off-canon writes) and `reconcile` (Stop, every verdict gets a card) |
| **Memory** | `memory/*.md` | Cards carry the rule ids that approved them, so `rule-audit` can name what outcome data supports |

`src/`, `tests/`, `scripts/` are the engine; `CONTRIBUTING.md` is its developer contract, `CLAUDE.md`
is the operator's — the two never mix.

---

## Outcome surfaces

| Surface | Status | Metric | Notes |
|---|---|---|---|
| Landing page | live | visits | Local visit logger — what the cold-run demo measures |
| Answer engines | live | canon match | Our own check, no external key |
| Meta ads | available, not configured | cost / signup | Real registered stub — fails loudly naming the missing env vars, counts toward neither side (`data/adapters-meta.md`) |
| LinkedIn ads | available, not configured | cost / signup | Same shape; CSV import path documented (`data/adapters-linkedin.md`) |

A stub is a real, registered surface — the moment you point it at a live account, `npm run measure`
reports on it honestly. Until then it can neither flatter nor damage the number.

---

## Base44 hosting

The board runs on Base44 as a genuine Base44 app — the dogfooding is structural, not cosmetic.

- **Public board:** https://roundtrip-board-ecceb49b.base44.app
- **Driver-based storage.** `src/cards/card-store.ts` defines a `CardStore` interface; `JsonlCardStore`
  is the default cold-run path (zero credentials), and `src/cards/base44-card-store.ts` is a
  `Base44CardStore` over the Base44 SDK, selected by `ROUNDTRIP_STORE=base44`. Both satisfy the same
  reusable contract suite, which skips cleanly without `BASE44_APP_ID` — a cold clone never touches
  Base44.
- **Hosted pieces** (in a separate project, so this fork stays clean): `Card` / `Visit` entities
  mirroring the schema; a client board plus a `board` serverless function running the *byte-identical*
  vendored compute layer; a token-gated `cards` ingest (closed by default) and a `visit` function that
  cannot set provenance. The honesty discipline is identical whether the number is computed locally or
  in the cloud.

`ROUNDTRIP_STORE` defaults to `jsonl`, so the cold-run guarantee is untouched.

**One honest caveat:** the hosted board still runs the older client. The campaign detail view
described above landed locally and has not been ported yet. The compute layer is deliberately
untouched by that change and stays byte-identical across both, so the *number* is the same in either
place — it is the presentation that differs. Run `npm run board` for the current view.

---

## Command reference

| Command | What it does |
|---|---|
| `npm run demo` | The full zero-key loop (fetch fonts → build → verify → measure → serve → stop) |
| `npm run board` | Serve the board at `http://127.0.0.1:4174` |
| `npm test` | Full suite (428 passing, 7 live-Base44 tests skipped without `BASE44_APP_ID`) |
| `npm run typecheck` | `tsc --noEmit` (no build step) |
| `npm run measure` | Pull outcomes through every adapter and attach them to cards |
| `npm run measure -- --csv <path>` | Import a gated surface's results from CSV (labelled `manual`) |
| `npm run verify:page -- <path-to-html>` | Playwright checks against one rendered page |
| `npm run lint:brand` / `npm run lint:design` | The linters the hooks run, over stdin |
| `npx tsx src/render/cli-build.ts --card <cardId>` | Build the page + social card for an existing card |

There is **no** `npm run build` — the `cli-build` command above is the real entrypoint.

---

## Project structure

```
agents/     writer, brand-guardian, designer, design-guardian, analyst (operator interface)
skills/     launch-campaign, measure, rule-audit, marketing-router
brand/      voice-guide.md, rules.md, DESIGN.md, audiences.md   (the canon — source of truth)
data/       source-base1.md (the only factual ground), adapter docs
hooks/      brand-lint, design-lint, reconcile (filesystem enforcement)
src/        cards · metric · lint · render · verify · adapters · board  (the engine)
tests/      unit, integration, and the cold-clone acceptance test
scripts/    demo.sh, fetch-fonts.sh
```

---

## Assignment deliverables

`DECISION.md`, `LAUNCH-POST.md`, and `LOOM-SCRIPT.md` at the repo root are the take-home's three
required artifacts — each verified against the code as built, not the plan that predated it.
