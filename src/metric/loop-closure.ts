import { type Card, COUNTING_PROVENANCES } from "../cards/schema.js";
import { getSurface } from "./surfaces.js";

export interface LoopClosure {
  readonly closed: number;
  readonly eligible: number;
  readonly inFlight: number;
  /** null when nothing is eligible. Never report 0% for "no data". */
  readonly rate: number | null;
}

function isShipped(card: Card): boolean {
  return (card.status === "shipped" || card.status === "measured") && card.shipped_at !== null;
}

function elapsedSinceShip(card: Card, now: Date): number {
  return now.getTime() - new Date(card.shipped_at as string).getTime();
}

/** Rule 3: a card only enters the denominator once its surface's grace period has passed. */
function isEligible(card: Card, now: Date): boolean {
  if (!isShipped(card)) return false;
  return elapsedSinceShip(card, now) >= getSurface(card.surface ?? card.channel).tMatureMs;
}

/**
 * Rules 1, 2 and 4. An eligible card is closed when it has an outcome whose
 * provenance counts (seeded never does), and that measurement is still fresh.
 * A value of 0 is a measurement; a null outcome is not.
 */
function isClosed(card: Card, now: Date): boolean {
  const outcome = card.outcome;
  if (outcome === null) return false;
  if (typeof outcome.value !== "number" || Number.isNaN(outcome.value)) return false;
  if (!COUNTING_PROVENANCES.includes(outcome.provenance)) return false;
  const age = now.getTime() - new Date(outcome.measured_at).getTime();
  return age <= getSurface(card.surface ?? card.channel).ttlMs;
}

export function loopClosure(cards: readonly Card[], now: Date): LoopClosure {
  const eligibleCards = cards.filter((c) => isEligible(c, now));
  const inFlight = cards.filter((c) => isShipped(c) && !isEligible(c, now)).length;
  const closed = eligibleCards.filter((c) => isClosed(c, now)).length;
  const eligible = eligibleCards.length;
  return { closed, eligible, inFlight, rate: eligible === 0 ? null : closed / eligible };
}

/** Always a fraction with both integers visible. A bare percentage lies at small N. */
export function formatLoopClosure(result: LoopClosure): string {
  if (result.rate === null) return "—";
  return `${result.closed} of ${result.eligible} measured`;
}
