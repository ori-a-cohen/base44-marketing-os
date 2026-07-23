import { describe, it, expect } from "vitest";
import { loopClosure, formatLoopClosure } from "../../src/metric/loop-closure.js";
import { parseCard, type Card, type Provenance } from "../../src/cards/schema.js";

const NOW = new Date("2026-07-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function shipped(opts: {
  id: string;
  shippedHoursAgo: number;
  outcome?: { value: number; provenance: Provenance; measuredHoursAgo: number };
}): Card {
  return parseCard({
    id: opts.id,
    channel: "landing_page",
    surface: "landing_page",
    topic: "Base1",
    status: "shipped",
    created: "2026-07-20",
    shipped_at: hoursAgo(opts.shippedHoursAgo),
    outcome: opts.outcome
      ? {
          card_id: opts.id, surface: "landing_page", metric: "visits",
          value: opts.outcome.value, unit: "count",
          measured_at: hoursAgo(opts.outcome.measuredHoursAgo),
          source: "test", provenance: opts.outcome.provenance,
        }
      : null,
  });
}

describe("loop-closure rate — the four honesty rules", () => {
  it("RULE 1: a seeded outcome is excluded from the numerator", () => {
    const r = loopClosure([shipped({
      id: "cc-1", shippedHoursAgo: 24,
      outcome: { value: 100, provenance: "seeded", measuredHoursAgo: 1 },
    })], NOW);
    expect(r.eligible).toBe(1);
    expect(r.closed).toBe(0);
  });

  it("RULE 1b: real and manual outcomes both count", () => {
    const r = loopClosure([
      shipped({ id: "a", shippedHoursAgo: 24, outcome: { value: 5, provenance: "real", measuredHoursAgo: 1 } }),
      shipped({ id: "b", shippedHoursAgo: 24, outcome: { value: 5, provenance: "manual", measuredHoursAgo: 1 } }),
    ], NOW);
    expect(r.closed).toBe(2);
  });

  it("RULE 2: a value of zero counts as measured", () => {
    const r = loopClosure([shipped({
      id: "cc-2", shippedHoursAgo: 24,
      outcome: { value: 0, provenance: "real", measuredHoursAgo: 1 },
    })], NOW);
    expect(r.closed).toBe(1);
    expect(r.rate).toBe(1);
  });

  it("RULE 2b: a null outcome does not count", () => {
    const r = loopClosure([shipped({ id: "cc-3", shippedHoursAgo: 24 })], NOW);
    expect(r.eligible).toBe(1);
    expect(r.closed).toBe(0);
  });

  it("RULE 3: a card younger than the maturation window is in flight, not in the denominator", () => {
    const r = loopClosure([shipped({ id: "cc-4", shippedHoursAgo: 0 })], NOW);
    expect(r.eligible).toBe(0);
    expect(r.inFlight).toBe(1);
    expect(r.rate).toBeNull();
  });

  it("RULE 4: a stale outcome leaves the numerator but stays in the denominator", () => {
    const r = loopClosure([shipped({
      id: "cc-5", shippedHoursAgo: 24 * 30,
      outcome: { value: 40, provenance: "real", measuredHoursAgo: 24 * 21 },
    })], NOW);
    expect(r.eligible).toBe(1);
    expect(r.closed).toBe(0);
  });

  it("RULE 5: zero eligible cards yields a null rate, never zero", () => {
    const r = loopClosure([], NOW);
    expect(r.eligible).toBe(0);
    expect(r.rate).toBeNull();
    expect(formatLoopClosure(r)).toBe("—");
  });

  it("unshipped cards never enter either side", () => {
    const draft = parseCard({
      id: "d", channel: "landing_page", topic: "t", status: "drafted", created: "2026-07-20",
    });
    const r = loopClosure([draft], NOW);
    expect(r.eligible).toBe(0);
    expect(r.inFlight).toBe(0);
  });

  it("producing more unmeasured content drives the rate DOWN", () => {
    const measured = shipped({
      id: "m", shippedHoursAgo: 24, outcome: { value: 9, provenance: "real", measuredHoursAgo: 1 },
    });
    const before = loopClosure([measured], NOW);
    const after = loopClosure(
      [measured, shipped({ id: "u1", shippedHoursAgo: 24 }), shipped({ id: "u2", shippedHoursAgo: 24 })],
      NOW,
    );
    expect(before.rate).toBe(1);
    expect(after.rate).toBeCloseTo(1 / 3);
    expect(after.rate!).toBeLessThan(before.rate!);
  });

  it("formats as a fraction, never a bare percentage", () => {
    const r = loopClosure([
      shipped({ id: "a", shippedHoursAgo: 24, outcome: { value: 1, provenance: "real", measuredHoursAgo: 1 } }),
      shipped({ id: "b", shippedHoursAgo: 24 }),
    ], NOW);
    expect(formatLoopClosure(r)).toBe("1 of 2 measured");
  });
});
