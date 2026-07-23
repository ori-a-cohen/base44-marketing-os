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

  describe("Fix 1: dedup by card identity, deflation-biased across supersession", () => {
    it("two distinct rows sharing an id and version count once, and the last row wins", () => {
      const first = shipped({
        id: "dup-1", shippedHoursAgo: 24,
        outcome: { value: 5, provenance: "real", measuredHoursAgo: 1 }, version: 1,
      });
      const second = shipped({ id: "dup-1", shippedHoursAgo: 24, version: 1 }); // no outcome
      const r = loopClosure([first, second], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });

    it("a v2 appearing before its v1 in the file still wins on version, not file order", () => {
      // v1 is measured and v2 is not, so the rows disagree: a position-based
      // tie rule (last row in the file wins) would say closed, while the
      // correct version-over-position rule says not closed.
      const v1 = shipped({
        id: "order-1", shippedHoursAgo: 48,
        outcome: { value: 1, provenance: "real", measuredHoursAgo: 40 }, version: 1,
      });
      const v2 = shipped({ id: "order-1", shippedHoursAgo: 24, version: 2 });
      const r = loopClosure([v2, v1], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });

    it("v1 shipped and measured, no v2: eligible and closed (unchanged)", () => {
      const v1 = shipped({
        id: "regen-0", shippedHoursAgo: 24,
        outcome: { value: 5, provenance: "real", measuredHoursAgo: 1 }, version: 1,
      });
      const r = loopClosure([v1], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(1);
    });

    it("v1 shipped and measured, then v2 drafted: eligible but NOT closed -- the regenerated artifact must earn its own outcome", () => {
      const v1 = shipped({
        id: "regen-1", shippedHoursAgo: 24,
        outcome: { value: 5, provenance: "real", measuredHoursAgo: 1 }, version: 1,
      });
      const v2 = parseCard({
        id: "regen-1", channel: "landing_page", surface: "landing_page", topic: "Base1",
        status: "drafted", created: "2026-07-20", version: 2,
      });
      const r = loopClosure([v1, v2], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });

    it("v1 shipped and unmeasured, then v2 drafted: eligible, not closed -- unmeasured shipped work must not vanish from the denominator", () => {
      const v1 = shipped({ id: "regen-3", shippedHoursAgo: 24, version: 1 });
      const v2 = parseCard({
        id: "regen-3", channel: "landing_page", surface: "landing_page", topic: "Base1",
        status: "drafted", created: "2026-07-20", version: 2,
      });
      const r = loopClosure([v1, v2], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });

    it("v2 shipped and measured, superseding a shipped v1: eligible, closed, counted once", () => {
      const v1 = shipped({
        id: "regen-2", shippedHoursAgo: 48,
        outcome: { value: 3, provenance: "real", measuredHoursAgo: 40 }, version: 1,
      });
      const v2 = shipped({
        id: "regen-2", shippedHoursAgo: 24,
        outcome: { value: 9, provenance: "real", measuredHoursAgo: 1 }, version: 2,
      });
      const r = loopClosure([v1, v2], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(1);
    });

    it("re-shipping a mature, unmeasured v1 as a fresh v2 does not shrink the denominator", () => {
      const v1 = shipped({ id: "reship-1", shippedHoursAgo: 24 * 3, version: 1 });
      const v2 = shipped({ id: "reship-1", shippedHoursAgo: 1 / 60, version: 2 });
      const r = loopClosure([v1, v2], NOW);
      expect(r.eligible).toBe(1);
      expect(r.inFlight).toBe(0);
      expect(r.closed).toBe(0);
    });

    it("a corrupt shipped_at on the newest version does not mask a well-formed, matured earlier version", () => {
      const v1 = shipped({ id: "corrupt-1", shippedHoursAgo: 24 * 3, version: 1 });
      const v2 = parseCard({
        id: "corrupt-1", channel: "landing_page", surface: "landing_page", topic: "Base1",
        status: "shipped", created: "2026-07-20", version: 2, shipped_at: null,
      });
      const r = loopClosure([v1, v2], NOW);
      expect(r.eligible).toBe(1);
      expect(r.malformed).toBe(0);
    });
  });

  describe("Fix 2 (round 3): isClosed requires the latest row to itself be shipped/measured", () => {
    it("a hand-edited latest row reverted to drafted, but still carrying shipped_at and an outcome, does not close the loop", () => {
      const v1 = shipped({ id: "hand-edit-1", shippedHoursAgo: 24 * 3, version: 1 }); // matured, unmeasured -> eligible
      const shippedV2 = shipped({
        id: "hand-edit-1", shippedHoursAgo: 24,
        outcome: { value: 5, provenance: "real", measuredHoursAgo: 1 }, version: 2,
      });
      const handEditedV2: Card = { ...shippedV2, status: "drafted" };
      const r = loopClosure([v1, handEditedV2], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });
  });

  describe("Fix 2: a measurement must postdate the ship, and belong to the card it's on", () => {
    it("an outcome measured before the card shipped does not count as closed", () => {
      const r = loopClosure([shipped({
        id: "pre-ship-1", shippedHoursAgo: 24,
        outcome: { value: 5, provenance: "real", measuredHoursAgo: 72 },
      })], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });

    it("an outcome whose card_id does not match the card's id does not count as closed", () => {
      const r = loopClosure([shippedWithRawOutcome("mismatch-1", 24, {
        card_id: "someone-else", surface: "landing_page", metric: "visits", value: 5, unit: "count",
        measured_at: hoursAgo(1), source: "test", provenance: "real",
      })], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });
  });

  describe("Fix 3: a null ship timestamp is malformed, never invisible", () => {
    it("status shipped with shipped_at null counts as malformed, not silently dropped from every count", () => {
      const r = loopClosure([parseCard({
        id: "null-ship-1", channel: "landing_page", surface: "landing_page", topic: "Base1",
        status: "shipped", created: "2026-07-20", shipped_at: null,
      })], NOW);
      expect(r.malformed).toBe(1);
      expect(r.eligible).toBe(0);
      expect(r.inFlight).toBe(0);
      expect(r.closed).toBe(0);
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
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });

    it("an outcome with an unknown provenance string does not count", () => {
      const r = loopClosure([shippedWithRawOutcome("est-1", 24, {
        card_id: "est-1", surface: "landing_page", metric: "visits", value: 5, unit: "count",
        measured_at: hoursAgo(1), source: "test", provenance: "estimated",
      })], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });

    it("an outcome missing measured_at does not count", () => {
      const r = loopClosure([shippedWithRawOutcome("nm-1", 24, {
        card_id: "nm-1", surface: "landing_page", metric: "visits", value: 5, unit: "count",
        source: "test", provenance: "real",
      })], NOW);
      expect(r.eligible).toBe(1);
      expect(r.closed).toBe(0);
    });

    it("an Infinity value does not count", () => {
      const r = loopClosure([shipped({
        id: "inf-1", shippedHoursAgo: 24,
        outcome: { value: Infinity, provenance: "real", measuredHoursAgo: 1 },
      })], NOW);
      expect(r.eligible).toBe(1);
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

  describe("Fix 3b: the rendered fraction exposes a shrinking denominator", () => {
    it("appends the malformed count to the fraction when malformed > 0", () => {
      const r = loopClosure([
        shipped({ id: "a", shippedHoursAgo: 24, outcome: { value: 1, provenance: "real", measuredHoursAgo: 1 } }),
        shipped({ id: "b", shippedHoursAgo: 24 }),
        parseCard({
          id: "bad", channel: "landing_page", surface: "landing_page", topic: "Base1",
          status: "shipped", created: "2026-07-20", shipped_at: null,
        }),
      ], NOW);
      expect(r.eligible).toBe(2);
      expect(r.malformed).toBe(1);
      expect(formatLoopClosure(r)).toBe("1 of 2 measured (1 with an unreadable ship time)");
    });

    it("leaves the format unchanged when malformed is 0", () => {
      const r = loopClosure([
        shipped({ id: "a", shippedHoursAgo: 24, outcome: { value: 1, provenance: "real", measuredHoursAgo: 1 } }),
      ], NOW);
      expect(r.malformed).toBe(0);
      expect(formatLoopClosure(r)).toBe("1 of 1 measured");
    });

    it("appends the malformed count even when the rate is null (no eligible cards at all)", () => {
      const r = loopClosure([shippedMalformed("bad-only")], NOW);
      expect(r.rate).toBeNull();
      expect(r.eligible).toBe(0);
      expect(r.malformed).toBe(1);
      expect(formatLoopClosure(r)).toBe("— (1 with an unreadable ship time)");
    });
  });
});
