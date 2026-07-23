import { describe, it, expect } from "vitest";
import { loopClosure, formatLoopClosure } from "../../src/metric/loop-closure.js";
import { parseCard, type Card, type Provenance } from "../../src/cards/schema.js";

const NOW = new Date("2026-07-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function shipped(opts: {
  id: string;
  shippedHoursAgo: number;
  outcome?: { value: number; provenance: Provenance; measuredHoursAgo: number };
  version?: number;
}): Card {
  return parseCard({
    id: opts.id,
    channel: "landing_page",
    surface: "landing_page",
    topic: "Base1",
    status: "shipped",
    created: "2026-07-20",
    version: opts.version,
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

/** Builds a shipped card with a raw, un-narrowed outcome object -- for exercising
 * fields (or their absence) that the typed `shipped()` helper cannot express. */
function shippedWithRawOutcome(
  id: string,
  shippedHoursAgo: number,
  outcome: Record<string, unknown> | null,
): Card {
  return parseCard({
    id, channel: "landing_page", surface: "landing_page", topic: "Base1",
    status: "shipped", created: "2026-07-20",
    shipped_at: hoursAgo(shippedHoursAgo),
    outcome,
  });
}

/** A shipped card whose shipped_at is not a parseable timestamp at all. */
function shippedMalformed(id: string): Card {
  return parseCard({
    id, channel: "landing_page", surface: "landing_page", topic: "Base1",
    status: "shipped", created: "2026-07-20",
    shipped_at: "not-a-real-timestamp",
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
    if (before.rate === null || after.rate === null) {
      throw new Error("expected both rates to be non-null for this comparison");
    }
    expect(after.rate).toBeLessThan(before.rate);
  });

  it("BOUNDARY: a card exactly at the maturation window is eligible, not in flight", () => {
    // landing_page.tMatureMs is 15 minutes = 0.25 hours.
    const r = loopClosure([shipped({ id: "b-mature", shippedHoursAgo: 0.25 })], NOW);
    expect(r.eligible).toBe(1);
    expect(r.inFlight).toBe(0);
  });

  it("BOUNDARY: a measurement exactly at the TTL edge still counts as closed", () => {
    // landing_page.ttlMs is 7 days = 168 hours.
    const r = loopClosure([shipped({
      id: "b-ttl", shippedHoursAgo: 24 * 30,
      outcome: { value: 10, provenance: "real", measuredHoursAgo: 24 * 7 },
    })], NOW);
    expect(r.closed).toBe(1);
  });

  describe("Fix 1: dedup by card identity", () => {
    it("two rows sharing an id and version (a duplicate append) count once", () => {
      const row = shipped({
        id: "dup-1", shippedHoursAgo: 24,
        outcome: { value: 5, provenance: "real", measuredHoursAgo: 1 },
      });
      const r = loopClosure([row, row], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(1);
    });

    it("a v2 drafted regeneration does not inherit its v1's shipped-and-measured outcome", () => {
      const measured = shipped({
        id: "m", shippedHoursAgo: 24, outcome: { value: 9, provenance: "real", measuredHoursAgo: 1 },
      });
      const v1 = shipped({
        id: "regen-1", shippedHoursAgo: 24,
        outcome: { value: 5, provenance: "real", measuredHoursAgo: 1 }, version: 1,
      });
      const v2 = parseCard({
        id: "regen-1", channel: "landing_page", surface: "landing_page", topic: "Base1",
        status: "drafted", created: "2026-07-20", version: 2,
      });
      const r = loopClosure([measured, v1, v2], NOW);
      // The pair reduces to v2 (drafted, unshipped), which contributes nothing to
      // either side of the ratio -- the rate reflects only `measured`, never v1's.
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(1);
      expect(r.rate).toBe(1);
    });
  });

  describe("Fix 3: malformed timestamps must not hide cards", () => {
    it("a shipped card with an unparseable shipped_at is counted as malformed", () => {
      const r = loopClosure([shippedMalformed("bad-1")], NOW);
      expect(r.malformed).toBe(1);
    });

    it("a malformed card is excluded from eligible, closed, and inFlight alike", () => {
      const r = loopClosure([shippedMalformed("bad-2")], NOW);
      expect(r.eligible).toBe(0);
      expect(r.closed).toBe(0);
      expect(r.inFlight).toBe(0);
    });
  });

  describe("Fix 4: only well-formed, non-seeded, non-stale outcomes count", () => {
    it("an outcome missing provenance entirely does not count", () => {
      const r = loopClosure([shippedWithRawOutcome("np-1", 24, {
        card_id: "np-1", surface: "landing_page", metric: "visits", value: 5, unit: "count",
        measured_at: hoursAgo(1), source: "test",
      })], NOW);
      expect(r.closed).toBe(0);
    });

    it("an outcome with an unknown provenance string does not count", () => {
      const r = loopClosure([shippedWithRawOutcome("est-1", 24, {
        card_id: "est-1", surface: "landing_page", metric: "visits", value: 5, unit: "count",
        measured_at: hoursAgo(1), source: "test", provenance: "estimated",
      })], NOW);
      expect(r.closed).toBe(0);
    });

    it("an outcome missing measured_at does not count", () => {
      const r = loopClosure([shippedWithRawOutcome("nm-1", 24, {
        card_id: "nm-1", surface: "landing_page", metric: "visits", value: 5, unit: "count",
        source: "test", provenance: "real",
      })], NOW);
      expect(r.closed).toBe(0);
    });

    it("an Infinity value does not count", () => {
      const r = loopClosure([shipped({
        id: "inf-1", shippedHoursAgo: 24,
        outcome: { value: Infinity, provenance: "real", measuredHoursAgo: 1 },
      })], NOW);
      expect(r.closed).toBe(0);
    });

  });

  it("formats as a fraction, never a bare percentage", () => {
    const r = loopClosure([
      shipped({ id: "a", shippedHoursAgo: 24, outcome: { value: 1, provenance: "real", measuredHoursAgo: 1 } }),
      shipped({ id: "b", shippedHoursAgo: 24 }),
    ], NOW);
    expect(formatLoopClosure(r)).toBe("1 of 2 measured");
  });
});
