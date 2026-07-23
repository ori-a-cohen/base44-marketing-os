import { type Card, COUNTING_PROVENANCES } from "../cards/schema.js";
import { loopClosure, formatLoopClosure, type LoopClosure } from "../metric/loop-closure.js";
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
  const metricCards = cards.filter(isMetricEligibleSurface);
  const metric = loopClosure(metricCards, now);

  const surfaces = [...new Set(metricCards.map(surfaceOf))];
  const perSurface: SurfaceRow[] = surfaces.map((surface) => {
    const subset = metricCards.filter((c) => surfaceOf(c) === surface);
    const sub = loopClosure(subset, now);
    const scores = subset.map(scoreOf).filter((s): s is number => s !== null);
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
      byAudience: cohortRows(cards, (c) => c.audience_id),
      byCampaign: cohortRows(cards, (c) => c.campaign_id),
    },
    ruleAccountability: ruleAccountability(cards),
    stubSurfaces: Object.values(SURFACES).filter((s) => s.status === "stub").map((s) => s.id),
    cards,
  };
}
