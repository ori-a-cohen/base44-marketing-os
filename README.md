# Roundtrip

A fork of Base44's marketing-engineering starter that closes the loop the starter leaves open:
approved copy becomes a real landing page and a token-derived social card, and every shipped piece
comes back with a measured result attached to the rules that approved it. The headline number is
deliberately unflattering — **loop-closure rate**, reported as "N of M measured" — and it starts at
zero because the original schema had no field for what happened after publish.

## 90-second quickstart

```bash
npm install
npx playwright install chromium
npm run demo
npm run board
```

`npm run demo` (equivalently `bash scripts/demo.sh`) fetches Geist, seeds one approved card, builds
its landing page and social card, verifies the rendered page in a real headless browser, records a
genuine local page visit, serves the board, and confirms it answers — then shuts itself down. `npm
run board` then serves the board again at `http://127.0.0.1:4174` so you can browse what was built.

**No API keys are needed for this run.** The cold clone uses a local JSONL card store and a local
visit logger; nothing in the demo path talks to a paid API. This is enforced, not just documented —
`tests/acceptance/cold-clone.test.ts` runs the same script from a clean state and asserts it
completes with zero credentials configured.

## The four layers, and what Roundtrip added

| Layer | Starter had | Roundtrip adds |
|---|---|---|
| **Brain** | `writer.md`, `brand-guardian.md`, `skills/marketing-router/` — a writer that reads the canon first, a guardian that gates every draft | `agents/designer.md` (copy → page/card spec, tokens only), `agents/design-guardian.md` (scores the rendered artifact), `agents/analyst.md` (outcomes → surface scores; never writes content), `skills/launch-campaign/`, `skills/measure/`, `skills/rule-audit/`, and a numbered-per-rule guardian verdict (`brand/rules.md`) instead of one blurry score |
| **Visibility** | `activity-log.md` — one line per run | The live board (`src/board/`, `npm run board`) — cards, states, the loop-closure number, per-surface scores, and a rule-accountability view, all computed from the same JSONL log |
| **Movement** | `hooks/log-run.sh` — history writes itself | `hooks/brand-lint.sh` and `hooks/design-lint.sh` (PreToolUse — off-brand or off-token writes exit 2 and never reach disk) and `hooks/reconcile.sh` (Stop — every guardian verdict gets a card, POSTed to the board when one is configured) |
| **Memory** | `memory/MEMORY.md`, `memory/patterns.md` | Unchanged in shape — cards now carry the rule ids that approved them, so `skills/rule-audit/` can name which rules outcome data does and doesn't support |

Everything under `src/`, `tests/`, and `scripts/` is new build output for this system; `CONTRIBUTING.md`
is its developer contract (`CLAUDE.md` remains the *operator's* contract — the two never mix).

## The metric, in plain language

**Loop-closure rate — of everything published, how much do we actually know the result of?**

Four rules keep it honest, enforced in code (`src/metric/loop-closure.ts`), not by convention:

1. **Only real results count.** Sample/seeded data shows on the board, clearly marked, and can never
   enter the numerator — `COUNTING_PROVENANCES` excludes it structurally, not by review.
2. **Zero is an answer. Unknown isn't.** A page that got no visitors is measured — the outcome exists
   and its value is `0`. A page nobody checked has no outcome row at all, and does not count.
3. **New work gets a grace period.** A card doesn't enter the denominator until its surface's own
   maturity window has passed (15 minutes for a landing page, 1 hour for an answer-engine check, 1 day
   for an ad surface) — see `src/metric/surfaces.ts`.
4. **Results go stale.** Past each surface's TTL, a stale measurement drops back out of the numerator
   (it stays in the denominator) — walk away and the number drifts back down.

Always reported as **"3 of 4 measured"**, never as a percentage — at small N a percentage lies in
both directions. Producing more content without measuring it pushes the number *down*, never up.

## Outcome surfaces

| Surface | Status | Primary metric | Notes |
|---|---|---|---|
| Landing page | live | visits | Local visit logger — this is what the cold-run demo measures |
| Answer engines | live | canon match | Our own check, no external key |
| Meta ads | **available, not configured** | cost per signup | Registered as a real stub (`src/adapters/stubs.ts`) — same `Outcome` contract as a live adapter, fails loudly naming the missing env vars (`META_AD_ACCOUNT_ID`, `META_ACCESS_TOKEN`), contributes to neither side of the ratio. See `data/adapters-meta.md`. |
| LinkedIn ads | **available, not configured** | cost per signup | Same shape — CSV import path documented, no live credentials wired. Fails loudly naming what's missing. See `data/adapters-linkedin.md`. |

A stub is not a placeholder comment: it is a real, registered surface that a real `npm run measure`
run will report on honestly ("not configured, here's what you need") the moment someone points it at
a real account. Until then it cannot flatter or damage the loop-closure number, because it never
produces a countable outcome.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Full suite (372 tests as of this writing) |
| `npm run typecheck` | `tsc --noEmit`, no build step |
| `npm run lint:brand` | Runs the brand linter over stdin (what `hooks/brand-lint.sh` calls) |
| `npm run lint:design` | Runs the design-token linter over stdin (what `hooks/design-lint.sh` calls) |
| `npm run measure` | Pulls outcomes through every adapter and attaches them to matching cards |
| `npm run verify:page -- <path-to-html>` | Playwright checks against one rendered page |
| `npx tsx src/render/cli-build.ts --card <cardId>` | Builds the landing page + social card for an existing card by id (there is no generic `npm run build` — this is the actual entrypoint, see `src/render/cli-build.ts`) |

There is no `npm run build`. If you see one referenced elsewhere, it's wrong — the command above is
the real one.

## Design tokens actually enforced

`brand/DESIGN.md`'s front matter defines `colors` (background, ink, primary, muted), `typography`
(display, body, fallback), `spacing` (sm, md, lg), and two components (`cta-button`, `social-card`,
`caption`) that reference those base tokens — `cta-button.rounded` is `8px`, not a standalone
top-level design token. `src/lint/tokens.ts` — the code `hooks/design-lint.sh` runs on every write to
a content or generated-page path — checks colour only: any hex/rgb/hsl value not in the canon's
`colors` list is blocked, gradients are blocked, and non-`none` `box-shadow` is blocked. It does not
check radius, spacing, or typography values; those are enforced by the design-guardian agent scoring
a screenshot, not by this deterministic linter.

## What page verification actually checks

`src/verify/page.ts` (`npm run verify:page`) runs a real rendered page through headless Chromium and
checks: exactly one `h1`; exactly one CTA (`a.cta`), and if present, that its `href` carries both
`utm_content` and `utm_campaign` and was not rejected as a dead link; the `x-card-id` meta tag is
present; the not-official marker text is present; and there is no horizontal overflow at a 375px
mobile viewport. **It does not check colour contrast and it does not check whether the intended font
actually loaded** — both are named as deliberate, stated gaps in the code's own comments
(`src/verify/page.ts`), not silent omissions. Contrast and font-loading are judgement calls left to
the design-guardian agent scoring a screenshot, and to the honest font-fallback labelling described
below.

## Fonts: Geist ships, Dazzed doesn't

`brand/DESIGN.md` names Dazzed as the display face and Geist as the body face. Geist is SIL Open Font
License — redistributable — so `scripts/fetch-fonts.sh` downloads it into the gitignored
`assets/fonts/` directory (called automatically by `npm run demo`; run it yourself any time). Dazzed's
license permits use but not redistribution of the font file, so **it is never fetched or committed**.
The renderer resolves the display face `Dazzed-*` → `Geist-*` → system, in that order, and reports
which one it actually used (`fontUsed.display`); `src/render/cli-build.ts` writes that value onto the
card as `attributes.display_font`, and a fallback is a labelled, visible seam on the board — never a
silent substitution. See `assets/fonts/README.md` and the "Known glyph exceptions" note in
`brand/DESIGN.md`.

## The 90-second demo, honestly described

`scripts/demo.sh` backdates the seeded card's `shipped_at` by 20 minutes before verifying it. This is
a demo-clock convenience, not a claim about elapsed time: `landing_page`'s maturity window
(`src/metric/surfaces.ts`) is 15 minutes, and a 90-second script cannot wait that out in real time.
**Only the ship timestamp is moved** — the measured outcome that follows is a genuine real local page
visit, recorded by the same visit logger a real run would use. If you run the demo and then click
through to the card's own generated page yourself before running `npm run measure`, you'll see your
own click count toward the same real outcome.

## Base44 hosting: live

The board is hosted on Base44 as a real Base44 app — the dogfooding is structural, not cosmetic.

- **Public board:** https://roundtrip-board-ecceb49b.base44.app — the same honest loop-closure
  number this repo computes locally, served from hosted data.
- **Storage is driver-based.** `src/cards/card-store.ts` defines a `CardStore` interface with a
  default `JsonlCardStore` (the cold-run path — zero credentials). Beside it,
  `src/cards/base44-card-store.ts` is a `Base44CardStore` over the Base44 SDK, selected by
  `ROUNDTRIP_STORE=base44` (needs `BASE44_APP_ID`). Both satisfy the same reusable contract suite
  (`tests/cards/card-store-contract.test.ts`), which skips cleanly when `BASE44_APP_ID` is absent, so
  a cold clone never touches Base44 and still closes the loop.
- **Hosted pieces** (in a separate project outside this repo, so the fork stays clean): `Card` and
  `Visit` entities mirroring `src/cards/schema.ts`; a client board plus a `board` serverless function
  that runs the *same* vendored, byte-identical compute layer; a token-gated `cards` ingest function
  (closed by default — no token, no writes) and a `visit` function that cannot set provenance. The
  headline number obeys the identical honesty discipline whether computed locally or in the cloud.

The cold-run guarantee is untouched: `ROUNDTRIP_STORE` defaults to `jsonl`, and `npm run demo` still
closes the loop with zero API keys and no network.

## Assignment deliverables

`DECISION.md`, `LAUNCH-POST.md`, and `LOOM-SCRIPT.md` at the repo root are the take-home's three
required artifacts, verified against the code as built rather than against the plan that predated it.
