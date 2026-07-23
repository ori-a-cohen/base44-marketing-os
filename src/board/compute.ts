import { type Card, COUNTING_PROVENANCES } from "../cards/schema.js";
import { loopClosure, formatLoopClosure, dedupeToLatestVersion, type LoopClosure } from "../metric/loop-closure.js";
import { getSurface, normalizeScore, SURFACES } from "../metric/surfaces.js";

/** No pattern is reported as a finding below this many observations in a cell. */
export const EVIDENCE_THRESHOLD = 5;

/** The numbered rules in brand/rules.md. */
const RULE_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export interface SurfaceRow {
  readonly surface: string;
  readonly label: string;
  readonly closed: number;
  readonly eligible: number;
  /** null when no card on this surface has a countable measurement -- never 0 for "no data". */
  readonly score: number | null;
}

export interface CohortRow {
  readonly key: string;
  readonly n: number;
  /** null when no card in this cohort has a countable measurement -- never 0 for "no data". */
  readonly meanScore: number | null;
  readonly gated: boolean;
}

export interface RuleRow {
  readonly rule: number;
  readonly status: "supported" | "taste-only";
  readonly measuredCards: number;
}

export interface BoardView {
  readonly metric: LoopClosure;
  readonly metricLabel: string;
  readonly perSurface: readonly SurfaceRow[];
  readonly cohorts: {
    readonly byAudience: readonly CohortRow[];
    readonly byCampaign: readonly CohortRow[];
  };
  readonly ruleAccountability: readonly RuleRow[];
  readonly stubSurfaces: readonly string[];
  readonly cards: readonly Card[];
}

function surfaceOf(card: Card): string {
  return card.surface ?? card.channel;
}

/** Stub surfaces contribute to neither side of the ratio. */
function isMetricEligibleSurface(card: Card): boolean {
  return getSurface(surfaceOf(card)).status !== "stub";
}

/**
 * A card's outcome counts toward a displayed score only when it carries a
 * countable provenance. Seeded outcomes are fixture/demo data -- exactly the
 * exclusion loop-closure applies to the headline rate applies here too, so a
 * per-surface or per-cohort score can never be inflated by seed data that
 * was never a real measurement.
 */
function hasCountableOutcome(card: Card): card is Card & { outcome: NonNullable<Card["outcome"]> } {
  return card.outcome !== null && COUNTING_PROVENANCES.includes(card.outcome.provenance);
}

function scoreOf(card: Card): number | null {
  if (!hasCountableOutcome(card)) return null;
  return normalizeScore(surfaceOf(card), card.outcome.value);
}

function meanOf(scores: readonly number[]): number | null {
  return scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * `cards` here must already be deduped to one row per logical id (see
 * `dedupeToLatestVersion`) -- `n` counts logical cards, not log rows, and it
 * gates the evidence threshold, so a regenerated card must never inflate it.
 */
function cohortRows(cards: readonly Card[], keyOf: (c: Card) => string | null): CohortRow[] {
  const groups = new Map<string, Card[]>();
  for (const c of cards) {
    const key = keyOf(c);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const scores = group.map(scoreOf).filter((s): s is number => s !== null);
    return {
      key,
      n: group.length,
      meanScore: meanOf(scores),
      gated: group.length < EVIDENCE_THRESHOLD,
    };
  });
}

/**
 * The selection effect is real: everything that ships passed nearly every
 * rule, so pass/fail variance on shipped content is near zero. A rule counts
 * as "supported" only when cards with a *countable* (non-seeded) measurement
 * actually carry a verdict for it -- this is correlation ("cards that passed
 * this rule and were then measured for real"), never proof the rule caused
 * the outcome. Seeded outcomes are excluded from the pool entirely: a fixture
 * card can never manufacture "supported" status for a rule that has no real
 * evidence behind it.
 *
 * `cards` here must already be deduped to one row per logical id -- a
 * regenerated card's superseded verdicts must not double-count support for a
 * rule.
 */
function ruleAccountability(cards: readonly Card[]): RuleRow[] {
  const measured = cards.filter(hasCountableOutcome);
  return RULE_NUMBERS.map((rule) => {
    const withVerdict = measured.filter((c) => c.verdicts.some((v) => v.rule === rule)).length;
    return {
      rule,
      status: withVerdict >= EVIDENCE_THRESHOLD ? "supported" : "taste-only",
      measuredCards: withVerdict,
    };
  });
}

export function computeBoard(cards: readonly Card[], now: Date): BoardView {
  // The one definition of "current version of a card" for every aggregation
  // below that counts logical cards or reads a card's current state: exactly
  // one row per id (see dedupeToLatestVersion in loop-closure.ts).
  const currentCards = dedupeToLatestVersion(cards);

  // Headline: deliberately NOT computed from currentCards. loopClosure needs
  // each id's full shipped history to judge eligibility (a matured,
  // unmeasured v1 must not vanish from the denominator just because a v2 was
  // drafted on top of it) -- so the raw, un-deduped cards are handed to it
  // unchanged, exactly as before this fix, and it performs its own identity
  // resolution internally.
  const metricCards = cards.filter(isMetricEligibleSurface);
  const metric = loopClosure(metricCards, now);

  // Per-surface partitions the SAME row set the headline counts --
  // `metricCards`, rows already filtered by each row's OWN countable surface
  // (isMetricEligibleSurface applied row-by-row) -- by that same row-own
  // surface. This is deliberately NOT the card's current surface:
  //
  //  - A stub-surface row can never land in any bucket, because it was
  //    already excluded from `metricCards` before bucketing even starts.
  //    That closes the inflation hole: a card whose only shipped history is
  //    on a stub surface cannot manufacture an "eligible" row under whatever
  //    live surface its current (unshipped) version happens to draft on.
  //  - A card's shipped history on a live surface stays attached to that
  //    surface regardless of what surface its CURRENT version lives on.
  //    That closes the under-count hole: shipped, matured, unmeasured work
  //    on a live surface still shows up even after the card's current
  //    version moved to a stub surface.
  //
  // Each bucket is handed to loopClosure so it performs its own identity
  // resolution and closure judgement per the surface-scoped subset of rows,
  // exactly as the headline does for the full set.
  const eligibleCurrentCards = currentCards.filter(isMetricEligibleSurface);
  const surfaces = [...new Set(metricCards.map(surfaceOf))];

  const perSurface: SurfaceRow[] = surfaces.map((surface) => {
    const rawSubset = metricCards.filter((c) => surfaceOf(c) === surface);
    const sub = loopClosure(rawSubset, now);

    // Score: only the CURRENT version's outcome, and only when the current
    // version itself is countable on this surface -- a superseded row's
    // value must never pollute the mean, and a card whose current version
    // has moved off this surface contributes no score to it (its current
    // state simply isn't measured here anymore).
    const currentSubset = eligibleCurrentCards.filter((c) => surfaceOf(c) === surface);
    const scores = currentSubset.map(scoreOf).filter((s): s is number => s !== null);
    const mean = meanOf(scores);

    return {
      surface,
      label: getSurface(surface).label,
      closed: sub.closed,
      eligible: sub.eligible,
      score: mean === null ? null : Math.round(mean),
    };
  });

  return {
    metric,
    metricLabel: formatLoopClosure(metric),
    perSurface,
    cohorts: {
      byAudience: cohortRows(currentCards, (c) => c.audience_id),
      byCampaign: cohortRows(currentCards, (c) => c.campaign_id),
    },
    ruleAccountability: ruleAccountability(currentCards),
    stubSurfaces: Object.values(SURFACES).filter((s) => s.status === "stub").map((s) => s.id),
    cards,
  };
}
