import { describe, it, expect } from "vitest";
import { computeBoard, EVIDENCE_THRESHOLD } from "../../src/board/compute.js";
import { parseCard, type Card } from "../../src/cards/schema.js";
import { loopClosure } from "../../src/metric/loop-closure.js";
import { getSurface, normalizeScore } from "../../src/metric/surfaces.js";

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

  // --- Dedup-drift regression: every aggregation must count logical cards,
  // not raw append-only log rows. ---

  describe("dedup drift: current version drives every aggregation", () => {
    it("dedupes two version-rows of one card in a cohort: n is 1, meanScore reflects only the current version", () => {
      const outcomeFor = (id: string, value: number) => ({
        card_id: id, surface: "landing_page", metric: "visits", value,
        unit: "count", measured_at: dayAgo, source: "test", provenance: "real" as const,
      });
      const v1 = card({
        id: "regen-cohort-1", version: 1, audience_id: "solo-builder",
        outcome: outcomeFor("regen-cohort-1", 5),
      });
      const v2 = card({
        id: "regen-cohort-1", version: 2, audience_id: "solo-builder",
        outcome: outcomeFor("regen-cohort-1", 40),
      });

      const view = computeBoard([v1, v2], NOW);
      const cohort = view.cohorts.byAudience.find((c) => c.key === "solo-builder");

      expect(cohort?.n).toBe(1);
      expect(cohort?.meanScore).toBe(normalizeScore("landing_page", 40));
    });

    // CORRECTED (see task-15 fix): the per-surface breakdown now partitions
    // by each ROW's OWN surface, not the card's current surface. Both v1
    // (shipped on aeo_check) and v2 (shipped on landing_page) are live,
    // countable rows, so this card's shipped history legitimately appears
    // under BOTH surfaces -- the work under the surface it actually
    // shipped on. The old expectation ("exactly one row, matching the
    // current version") encoded the bug this task fixes: it hid the
    // aeo_check work entirely once the card moved to landing_page, which is
    // precisely the under-count hole described in the task brief. Per-row
    // partitioning is what makes the stub-boundary under-count case (v1 on
    // a live surface, v2 drafted on a stub) show its shipped work at all.
    //
    // NOTE: this same case is a known, reported exception to the "sums never
    // exceed the headline" invariant for ELIGIBLE (see task-15 report):
    // loopClosure judges eligibility per-id from that id's full shipped
    // history, so splitting one id's two independently-mature shipped rows
    // across two buckets makes each bucket count it eligible on its own,
    // while the headline's single cross-surface dedup counts the id
    // eligible only once. eligibleSum (2) > headline eligible (1) here.
    // closedSum still equals headline closed, because only the current
    // version's row (v2, landing_page) can ever be judged closed.
    it("a card whose surface changed across two LIVE surfaces appears under both surfaces it actually shipped on", () => {
      const v1 = card({
        id: "regen-surface-1", version: 1, surface: "aeo_check", channel: "aeo_check",
        status: "shipped", shipped_at: dayAgo,
      });
      const v2 = card({
        id: "regen-surface-1", version: 2, surface: "landing_page", channel: "landing_page",
        status: "shipped", shipped_at: dayAgo,
        outcome: {
          card_id: "regen-surface-1", surface: "landing_page", metric: "visits", value: 10,
          unit: "count", measured_at: dayAgo, source: "test", provenance: "real",
        },
      });

      const view = computeBoard([v1, v2], NOW);

      const onLandingPage = view.perSurface.find((s) => s.surface === "landing_page");
      const onAeoCheck = view.perSurface.find((s) => s.surface === "aeo_check");
      expect(onLandingPage).toBeDefined();
      expect(onAeoCheck).toBeDefined();
      expect(onAeoCheck?.eligible).toBe(1);
      expect(onAeoCheck?.closed).toBe(0);
      expect(onLandingPage?.eligible).toBe(1);
      expect(onLandingPage?.closed).toBe(1);

      const closedSum = view.perSurface.reduce((sum, s) => sum + s.closed, 0);
      expect(closedSum).toBe(view.metric.closed);
      // eligibleSum intentionally NOT asserted <= headline here -- this is
      // the documented cross-live-surface exception, not a bug this task
      // fixes. See the general property test below for the invariant on
      // card sets that do not hit this specific overlap.
    });

    it("stub-boundary inflation: a stub-surface v1 must not manufacture a phantom eligible row on the current live surface", () => {
      // v1 shipped and matured on the STUB surface meta_ads; current v2 is
      // merely drafted on the live surface landing_page. The headline
      // correctly excludes the stub-surface row and reports eligible: 0.
      // Before this fix, the per-surface breakdown bucketed the id's ENTIRE
      // raw history (including the stub v1 row) under the current surface,
      // manufacturing eligible: 1 on landing_page -- inflation past the
      // headline. Now landing_page's bucket is built only from metricCards
      // (row-filtered), so v1 (stub) never enters any bucket at all.
      const v1 = card({
        id: "stub-inflate-1", version: 1, surface: "meta_ads", channel: "meta_ads",
        status: "shipped", shipped_at: dayAgo,
      });
      const v2 = card({
        id: "stub-inflate-1", version: 2, surface: "landing_page", channel: "landing_page",
        status: "drafted", shipped_at: null,
      });

      const view = computeBoard([v1, v2], NOW);

      expect(view.metric.eligible).toBe(0);
      const landingPage = view.perSurface.find((s) => s.surface === "landing_page");
      expect(landingPage?.eligible ?? 0).toBe(0);

      const eligibleSum = view.perSurface.reduce((sum, s) => sum + s.eligible, 0);
      const closedSum = view.perSurface.reduce((sum, s) => sum + s.closed, 0);
      expect(eligibleSum).toBe(view.metric.eligible);
      expect(closedSum).toBe(view.metric.closed);
    });

    it("stub-boundary under-count: shipped, matured work on a live surface still appears once the current version moves to a stub surface", () => {
      // v1 shipped, matured, and was never measured on the LIVE surface
      // aeo_check; current v2 is drafted on the STUB surface meta_ads. The
      // headline correctly still counts this real shipped work: eligible: 1.
      // Before this fix, the per-surface breakdown keyed off the card's
      // CURRENT surface only -- since that's a stub, the id was dropped from
      // the surface list entirely, and this real shipped work was invisible
      // in every per-surface row. Now aeo_check's bucket is built from v1
      // directly (its own, live, countable surface), independent of where
      // the card's current version now lives.
      const v1 = card({
        id: "stub-undercount-1", version: 1, surface: "aeo_check", channel: "aeo_check",
        status: "shipped", shipped_at: dayAgo,
      });
      const v2 = card({
        id: "stub-undercount-1", version: 2, surface: "meta_ads", channel: "meta_ads",
        status: "drafted", shipped_at: null,
      });

      const view = computeBoard([v1, v2], NOW);

      expect(view.metric.eligible).toBe(1);
      expect(view.metric.closed).toBe(0);

      const aeoCheck = view.perSurface.find((s) => s.surface === "aeo_check");
      expect(aeoCheck).toBeDefined();
      expect(aeoCheck?.eligible).toBe(1);
      expect(aeoCheck?.closed).toBe(0);
      // Current version lives on a stub surface, so it contributes no score
      // anywhere -- there is no live current row to score.
      expect(aeoCheck?.score).toBeNull();

      // Not dropped for being a stub-boundary case, and not double-counted
      // under meta_ads either (meta_ads is a stub, so it never gets a row).
      expect(view.perSurface.some((s) => s.surface === "meta_ads")).toBe(false);

      const eligibleSum = view.perSurface.reduce((sum, s) => sum + s.eligible, 0);
      const closedSum = view.perSurface.reduce((sum, s) => sum + s.closed, 0);
      expect(eligibleSum).toBe(view.metric.eligible);
      expect(closedSum).toBe(view.metric.closed);
    });

    it("task-15: a card independently closeable on two different LIVE surfaces closes exactly once, attributed to its current version's surface", () => {
      // v1 shipped on aeo_check, matured, measured with a real, fresh
      // outcome -- independently closeable if judged in isolation. v2
      // shipped on landing_page, also matured, also measured with a real,
      // fresh outcome -- also independently closeable in isolation. Before
      // this fix, bucketing by row-own surface and re-running loopClosure
      // per bucket let BOTH subsets pick their own row as "latest" and
      // judge it closed, so this single logical card was counted closed
      // twice (sum 2 > headline 1). The fix must attribute closure to
      // exactly the surface of the id's true current (highest) version:
      // landing_page.
      const v1 = card({
        id: "sb2", version: 1, surface: "aeo_check", channel: "aeo_check",
        status: "measured", shipped_at: new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
        outcome: {
          card_id: "sb2", surface: "aeo_check", metric: "canon_match", value: 60,
          unit: "count", measured_at: dayAgo, source: "test", provenance: "real",
        },
      });
      const v2 = card({
        id: "sb2", version: 2, surface: "landing_page", channel: "landing_page",
        status: "measured", shipped_at: new Date(NOW.getTime() - 10 * 86_400_000).toISOString(),
        outcome: {
          card_id: "sb2", surface: "landing_page", metric: "visits", value: 30,
          unit: "count", measured_at: dayAgo, source: "test", provenance: "real",
        },
      });

      const view = computeBoard([v1, v2], NOW);

      expect(view.metric.closed).toBe(1);
      expect(view.metric.eligible).toBe(1);

      const onAeoCheck = view.perSurface.find((s) => s.surface === "aeo_check");
      const onLandingPage = view.perSurface.find((s) => s.surface === "landing_page");
      expect(onAeoCheck?.closed).toBe(0);
      expect(onLandingPage?.closed).toBe(1);

      const closedSum = view.perSurface.reduce((sum, s) => sum + s.closed, 0);
      expect(closedSum).toBe(view.metric.closed);
    });

    it("property: sum(perSurface.closed) equals the headline exactly on a mixed set including both-independently-closeable-across-live-surfaces, and closed never exceeds eligible on any single surface", () => {
      const cards: Card[] = [
        measured("prop-a", 10),
        card({ id: "prop-b" }),
        // Stub-boundary inflation shape.
        card({ id: "prop-c", version: 1, surface: "meta_ads", channel: "meta_ads", status: "shipped", shipped_at: dayAgo }),
        card({ id: "prop-c", version: 2, surface: "landing_page", channel: "landing_page", status: "drafted", shipped_at: null }),
        // Stub-boundary under-count shape.
        card({ id: "prop-d", version: 1, surface: "aeo_check", channel: "aeo_check", status: "shipped", shipped_at: dayAgo }),
        card({ id: "prop-d", version: 2, surface: "meta_ads", channel: "meta_ads", status: "drafted", shipped_at: null }),
        // Independent card fully on aeo_check, closed.
        card({
          id: "prop-e", surface: "aeo_check", channel: "aeo_check", status: "measured", shipped_at: dayAgo,
          outcome: { card_id: "prop-e", surface: "aeo_check", metric: "canon_match", value: 60,
            unit: "count", measured_at: dayAgo, source: "test", provenance: "real" },
        }),
        // Pure stub-surface card, contributes nowhere.
        card({ id: "prop-f", surface: "linkedin_ads", channel: "linkedin_ads", status: "shipped", shipped_at: dayAgo }),
        // The two-live-surface, both-independently-closeable shape.
        card({
          id: "prop-g", version: 1, surface: "aeo_check", channel: "aeo_check",
          status: "measured", shipped_at: new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
          outcome: { card_id: "prop-g", surface: "aeo_check", metric: "canon_match", value: 55,
            unit: "count", measured_at: dayAgo, source: "test", provenance: "real" },
        }),
        card({
          id: "prop-g", version: 2, surface: "landing_page", channel: "landing_page",
          status: "measured", shipped_at: new Date(NOW.getTime() - 10 * 86_400_000).toISOString(),
          outcome: { card_id: "prop-g", surface: "landing_page", metric: "visits", value: 25,
            unit: "count", measured_at: dayAgo, source: "test", provenance: "real" },
        }),
      ];

      const view = computeBoard(cards, NOW);
      const closedSum = view.perSurface.reduce((sum, s) => sum + s.closed, 0);

      expect(closedSum).toBe(view.metric.closed);
      for (const s of view.perSurface) {
        expect(s.closed).toBeLessThanOrEqual(s.eligible);
      }
    });

    it("property: sum(perSurface) never exceeds the headline across a mixed card set (excluding the documented cross-live-surface exception)", () => {
      const cards: Card[] = [
        // Plain single-surface cards, closed and open.
        measured("mix-a", 10),
        card({ id: "mix-b" }),
        // Stub-boundary inflation shape.
        card({ id: "mix-c", version: 1, surface: "meta_ads", channel: "meta_ads", status: "shipped", shipped_at: dayAgo }),
        card({ id: "mix-c", version: 2, surface: "landing_page", channel: "landing_page", status: "drafted", shipped_at: null }),
        // Stub-boundary under-count shape.
        card({ id: "mix-d", version: 1, surface: "aeo_check", channel: "aeo_check", status: "shipped", shipped_at: dayAgo }),
        card({ id: "mix-d", version: 2, surface: "meta_ads", channel: "meta_ads", status: "drafted", shipped_at: null }),
        // A second, independent card fully on aeo_check, closed.
        card({
          id: "mix-e", surface: "aeo_check", channel: "aeo_check", status: "measured", shipped_at: dayAgo,
          outcome: { card_id: "mix-e", surface: "aeo_check", metric: "canon_match", value: 60,
            unit: "count", measured_at: dayAgo, source: "test", provenance: "real" },
        }),
        // Pure stub-surface card, contributes nowhere.
        card({ id: "mix-f", surface: "linkedin_ads", channel: "linkedin_ads", status: "shipped", shipped_at: dayAgo }),
      ];

      const view = computeBoard(cards, NOW);
      const eligibleSum = view.perSurface.reduce((sum, s) => sum + s.eligible, 0);
      const closedSum = view.perSurface.reduce((sum, s) => sum + s.closed, 0);

      expect(closedSum).toBeLessThanOrEqual(view.metric.closed);
      expect(eligibleSum).toBeLessThanOrEqual(view.metric.eligible);
    });

    it("computes per-surface score only from the current version, never a superseded row", () => {
      const v1 = card({
        id: "regen-score-1", version: 1,
        outcome: {
          card_id: "regen-score-1", surface: "landing_page", metric: "visits", value: 999,
          unit: "count", measured_at: dayAgo, source: "test", provenance: "real",
        },
      });
      const v2 = card({
        id: "regen-score-1", version: 2,
        outcome: {
          card_id: "regen-score-1", surface: "landing_page", metric: "visits", value: 10,
          unit: "count", measured_at: dayAgo, source: "test", provenance: "real",
        },
      });

      const view = computeBoard([v1, v2], NOW);
      const s = view.perSurface.find((x) => x.surface === "landing_page");
      expect(s?.score).toBe(normalizeScore("landing_page", 10));
    });

    it("keeps the headline identical to loopClosure on the raw, un-deduped cards -- the fix must not touch headline delegation", () => {
      const v1 = card({ id: "headline-check-1", version: 1 });
      const v2 = card({
        id: "headline-check-1", version: 2, surface: "aeo_check", channel: "aeo_check",
        status: "shipped", shipped_at: dayAgo,
      });
      const cardsSet = [v1, v2, measured("headline-check-2", 20)];

      const view = computeBoard(cardsSet, NOW);
      const direct = loopClosure(
        cardsSet.filter((c) => getSurface(c.surface ?? c.channel).status !== "stub"),
        NOW,
      );
      expect(view.metric).toEqual(direct);
    });
  });
});
