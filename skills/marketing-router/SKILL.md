---
name: marketing-router
description: Entry point for all marketing content. Reads the brand canon, routes to the writer, gates through the brand-guardian. Triggers on any request to write, create, or draft marketing content.
---

# Marketing Router

**Execution engine, not a menu.** When loaded: read canon → clarify the brief → dispatch writer → gate through guardian → deliver only approved content.

## The flow (every request)

1. **Canon first.** Read `brand/voice-guide.md` + `brand/rules.md`. If they still contain [placeholders], stop and help the operator fill them — that IS the session.
2. **Brief before writing.** Confirm with one message: channel · topic · audience · the one message · CTA. A missing answer is a question, not a guess. Never generate from thin air.
3. **Dispatch `agents/writer.md`** with the brief. The writer returns 2–3 variations.
4. **Gate through `agents/brand-guardian.md`.** Only a 9+ verdict reaches the human. One revision round on rejection; a second rejection escalates to the human with the guardian's findings.
5. **Log the run** — one line in `activity-log.md` (the hook in `hooks/log-run.sh` shows how to automate this).
6. **Update memory** — anything learned (a phrase that worked, a rejected angle and why) goes to `memory/patterns.md`.

## Iron laws

- No content without the canon read this session.
- No content to the human without a guardian verdict ≥ 9.
- No invented facts, numbers, or customer stories — unverifiable claims get cut, not softened.
- Every run leaves a trace (log + memory). A system that doesn't remember is a tool, not a teammate.

## Roundtrip routes

| The operator wants | Route to |
|---|---|
| content produced for a campaign | `skills/launch-campaign/SKILL.md` |
| to know how something performed | `skills/measure/SKILL.md` |
| to know which rules are working | `skills/rule-audit/SKILL.md` |
| to read sources and propose a brief | `skills/weekly-pulse/SKILL.md` (unchanged, read-only) |
