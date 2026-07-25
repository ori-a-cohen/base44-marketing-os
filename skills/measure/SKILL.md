---
name: measure
description: Use when the operator asks how content performed, wants to refresh outcomes, or asks about the loop-closure rate. Also use for "did it work", "results", "measure", "outcomes".
---

# Measure

Pull real outcomes through the adapters and advance card states.

## Run it

```bash
npm run measure                                   # all live adapters
npm run measure -- --csv path/to/report.csv       # import a gated platform's export
```

## The rules you may not break

1. **Seeded outcomes never enter the numerator.** This is enforced in `src/metric/loop-closure.ts`,
   not by convention. Do not add a code path around it.
2. **Zero is a measurement.** A page with no visitors closed its loop. Record `value: 0`,
   never null.
3. **A card younger than its surface's maturation window is in flight**, not a failure. Report it
   separately.
4. **A stale outcome must be retaken**, not carried forward.
5. **Report as a fraction with N.** "3 of 4 measured, 2 in flight". Never a bare percentage.

## Unconfigured surfaces

Meta and LinkedIn are registered stubs. They report themselves as *available, not configured* and
contribute to neither side of the ratio. Say so plainly rather than hiding them - an unconfigured
surface on the board communicates what the system is designed to measure.
