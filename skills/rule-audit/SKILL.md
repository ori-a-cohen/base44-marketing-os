---
name: rule-audit
description: Use when the operator asks which brand rules are working, wants cohort analysis, or asks whether the canon is improving. Also use for "which rules", "cohorts", "is it learning".
---

# Rule audit

Hold the canon accountable to outcomes. Invoke `agents/analyst.md`; it never writes content.

## The views

1. **Rule accountability** - for each numbered rule in `brand/rules.md`, is there measured outcome
   data behind it? A rule with none is **taste-only**, which is not the same as wrong.
2. **Cohort by canon version** - the one nothing else can do. Every change to `rules.md` opens a
   cohort. Compare content produced under v1 against v2 on the same surface.
3. **Cohort by audience segment** - which segment activates, not which signs up.
4. **Cohort by campaign and by week.**

## State the selection effect out loud

Everything that ships passed nearly every rule, so pass/fail variance on shipped content is close
to zero. The usable variance comes from two places: rules that **initially failed and were fixed**
(the revision history), and the **guardian's margin** (9.0 against 10). Say this whenever reporting
rule accountability. Reporting a correlation without it would be dishonest.

## The evidence gate

Below five observations in a cell, there is no finding. Report
**"not enough data yet - n of 5"** and move on. At demo scale this is a mechanism demonstration,
not a statistical claim, and saying so is the credible move.
