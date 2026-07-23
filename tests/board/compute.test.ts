import { describe, it, expect } from "vitest";
import { computeBoard, EVIDENCE_THRESHOLD } from "../../src/board/compute.js";
import { parseCard, type Card } from "../../src/cards/schema.js";

const NOW = new Date("2026-07-23T12:00:00Z");
const dayAgo = new Date(NOW.getTime() - 86_400_000).toISOString();

function card(over: Record<string, unknown>): Card {
  return parseCard({
    id: "cc-x", channel: "landing_page", surface: "landing_page", topic: "Base1",
    status: "shipped", created: "2026-07-20", shipped_at: dayAgo, ...over,
  });
}

const measured = (id: string, value: number) =>
  card({
    id,
    outcome: { card_id: id, surface: "landing_page", metric: "visits", value,
      unit: "count", measured_at: dayAgo, source: "local-visits", provenance: "real" },
  });

const seeded = (id: string, value: number) =>
  card({
    id,
    outcome: { card_id: id, surface: "landing_page", metric: "visits", value,
      unit: "count", measured_at: dayAgo, source: "seed-fixture", provenance: "seeded" },
  });

describe("computeBoard", () => {
  it("reports the headline metric as a fraction", () => {
    const view = computeBoard([measured("a", 10), card({ id: "b" })], NOW);
    expect(view.metric.closed).toBe(1);
    expect(view.metric.eligible).toBe(2);
    expect(view.metricLabel).toBe("1 of 2 measured");
  });

  it("breaks the rate down per surface", () => {
    const view = computeBoard([measured("a", 10)], NOW);
    const s = view.perSurface.find((x) => x.surface === "landing_page");
    expect(s?.closed).toBe(1);
    expect(s?.score).toBeGreaterThan(0);
  });

  it("labels a rule with no outcome support as taste-only", () => {
    const view = computeBoard([
      measured("a", 10),
    ], NOW);
    const rule5 = view.ruleAccountability.find((r) => r.rule === 5);
    expect(rule5?.status).toBe("taste-only");
  });

  it("gates cohort findings below the evidence threshold", () => {
    const view = computeBoard([measured("a", 10)], NOW);
    for (const c of view.cohorts.byAudience) {
      if (c.n < EVIDENCE_THRESHOLD) expect(c.gated).toBe(true);
    }
  });

  it("does not report a cohort as a finding at n = 1", () => {
    const view = computeBoard([
      card({ id: "a", audience_id: "solo-builder" }),
    ], NOW);
    expect(view.cohorts.byAudience.every((c) => c.gated)).toBe(true);
  });

  it("counts stub surfaces separately and excludes them from the metric", () => {
    const view = computeBoard([
      measured("a", 10),
      card({ id: "s", surface: "meta_ads", channel: "meta_ads" }),
    ], NOW);
    expect(view.metric.eligible).toBe(1);
    expect(view.stubSurfaces).toContain("meta_ads");
  });

  // --- Honesty properties: delegation to loopClosure must not be undermined ---

  it("produces a valid, empty board from zero cards (cold start, no crash)", () => {
    const view = computeBoard([], NOW);
    expect(view.metric.eligible).toBe(0);
    expect(view.metric.rate).toBeNull();
    expect(view.metricLabel).toBe("—");
    expect(view.perSurface).toEqual([]);
    expect(view.cohorts.byAudience).toEqual([]);
    expect(view.cohorts.byCampaign).toEqual([]);
    expect(view.cards).toEqual([]);
  });

  it("does not let a seeded outcome count toward rule accountability support", () => {
    // Five seeded outcomes on cards whose only verdict is rule 3 passing --
    // if seeded counted, rule 3 would cross EVIDENCE_THRESHOLD and be labeled
    // "supported" purely from fixture data, never from a real measurement.
    const cardsWithSeededRule3 = Array.from({ length: EVIDENCE_THRESHOLD }, (_, i) =>
      card({
        id: `seed-${i}`,
        verdicts: [{ rule: 3, pass: true, note: "looks right", gate: "brand" }],
        outcome: {
          card_id: `seed-${i}`, surface: "landing_page", metric: "visits", value: 999,
          unit: "count", measured_at: dayAgo, source: "seed-fixture", provenance: "seeded",
        },
      }),
    );
    const view = computeBoard(cardsWithSeededRule3, NOW);
    const rule3 = view.ruleAccountability.find((r) => r.rule === 3);
    expect(rule3?.status).toBe("taste-only");
    expect(rule3?.measuredCards).toBe(0);
  });

  it("does not let a seeded outcome inflate a per-surface or cohort score", () => {
    // A seeded outcome carries an inflated value (999); if it slipped into the
    // score average, the surface/cohort would report a rate that no real
    // measurement produced.
    const view = computeBoard([seeded("a", 999)], NOW);
    const s = view.perSurface.find((x) => x.surface === "landing_page");
    expect(s?.score).toBeNull();

    const seededInCohort = card({
      id: "b",
      audience_id: "solo-builder",
      outcome: { card_id: "b", surface: "landing_page", metric: "visits", value: 999,
        unit: "count", measured_at: dayAgo, source: "seed-fixture", provenance: "seeded" },
    });
    const cohortView = computeBoard([seededInCohort], NOW);
    const cohort = cohortView.cohorts.byAudience.find((c) => c.key === "solo-builder");
    expect(cohort?.meanScore).toBeNull();
  });

  it("reports a null (not zero) surface score when no card has measured", () => {
    const view = computeBoard([card({ id: "a" })], NOW);
    const s = view.perSurface.find((x) => x.surface === "landing_page");
    expect(s?.score).toBeNull();
  });
});
