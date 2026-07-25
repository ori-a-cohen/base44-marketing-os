---
name: launch-campaign
description: Use when the operator wants to produce marketing for a campaign - takes a brief through copy, both gates, real artifacts, and onto the board. Also use for "write a post", "launch", "landing page", "campaign".
---

# Launch a campaign

The full execution pipeline. Never skip a step, never merge two.

## 1. Confirm the brief

Five things, and one clarifying message is cheaper than one wrong draft:
channel · topic · **audience segment id from `brand/audiences.md`** · the one message · CTA.

If the audience is free text rather than a segment id, ask for the id. Free text cannot be measured.

## 2. Write

Invoke `agents/writer.md`. It re-reads the canon first; do not optimise that away.
Facts come only from the campaign's source file (`data/source-base1.md`). Anything not on that
list gets cut, not softened.

Produce 2-3 genuinely different angles, not one draft reworded.

## 3. Brand gate

Invoke `agents/brand-guardian.md`. Per-rule pass/fail against every numbered rule in
`brand/rules.md`, closing with the machine-read verdict block. Below 9 means one revision round;
a second rejection escalates to the human.

## 4. Build the artifacts

Invoke `agents/designer.md` to produce the page spec and card spec, then render:

```bash
npx tsx src/render/cli-build.ts --card <cardId>
```

## 5. Verify for free before you judge

```bash
npm run verify:page -- build/pages/<cardId>/index.html
```

Fix any failures before spending a model call. The deterministic checks cost nothing.

## 6. Design gate

Invoke `agents/design-guardian.md` on the rendered artifact. Same threshold, same escalation.

## 7. Card and board

The `Stop` hook reconciles verdicts into cards and posts them. Confirm the card appears with both
verdicts, `audience_id`, `campaign_id`, and its artifacts.

## 8. Memory

Record what was learned - a hook that worked, an angle rejected and why. If nothing was learned,
write nothing.

## What this skill never does

Publish. The human always presses publish. This pipeline ends at an approved, verified artifact.
