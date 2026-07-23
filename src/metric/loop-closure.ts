import { type Card, COUNTING_PROVENANCES } from "../cards/schema.js";
import { getSurface } from "./surfaces.js";

export interface LoopClosure {
  readonly closed: number;
  readonly eligible: number;
  readonly inFlight: number;
  /** Shipped cards whose shipped_at could not be parsed. Never silently folded into inFlight. */
  readonly malformed: number;
  /** null when nothing is eligible. Never report 0% for "no data". */
  readonly rate: number | null;
}

/**
 * The append-only log can carry multiple rows per card id: a duplicate
 * `appendCard`, or a v2 written by `nextVersion` while the v1 row still sits
 * in the log as shipped-and-measured. Reduce to the highest version per id
 * before counting, so a regenerated card starts over and can never inherit
 * its predecessor's measurement. Ties on the same (id, version) keep the
 * last row seen, since later rows are more recent in an append-only log.
 */
function latestVersionPerCard(cards: readonly Card[]): readonly Card[] {
  const latestById = new Map<string, Card>();
  for (const card of cards) {
    const existing = latestById.get(card.id);
    if (existing === undefined || card.version >= existing.version) {
      latestById.set(card.id, card);
    }
  }
  return [...latestById.values()];
}

/** The card's shipped_at, narrowed to string, but only when the card has actually shipped. */
function shippedAtOf(card: Card): string | null {
  if (card.status !== "shipped" && card.status !== "measured") return null;
  return card.shipped_at;
}

function isShipped(card: Card): boolean {
  return shippedAtOf(card) !== null;
}

function elapsedSinceShip(shippedAt: string, now: Date): number {
  return now.getTime() - new Date(shippedAt).getTime();
}

/** A shipped card whose shipped_at does not parse into a real instant. */
function isMalformedShip(card: Card, now: Date): boolean {
  const shippedAt = shippedAtOf(card);
  if (shippedAt === null) return false;
  return Number.isNaN(elapsedSinceShip(shippedAt, now));
}

/** Rule 3: a card only enters the denominator once its surface's grace period has passed. */
function isEligible(card: Card, now: Date): boolean {
  const shippedAt = shippedAtOf(card);
  if (shippedAt === null) return false;
  const elapsed = elapsedSinceShip(shippedAt, now);
  if (Number.isNaN(elapsed)) return false; // malformed timestamps are counted separately, never as eligible
  return elapsed >= getSurface(card.surface ?? card.channel).tMatureMs;
}

/**
 * Rules 1, 2 and 4. An eligible card is closed when it has an outcome whose
 * provenance counts (seeded never does), and that measurement is still fresh.
 * A value of 0 is a measurement; a null outcome is not. Number.isFinite also
 * rejects Infinity, which a typeof check plus Number.isNaN alone would admit.
 */
function isClosed(card: Card, now: Date): boolean {
  const outcome = card.outcome;
  if (outcome === null) return false;
  if (!Number.isFinite(outcome.value)) return false;
  if (!COUNTING_PROVENANCES.includes(outcome.provenance)) return false;
  const age = now.getTime() - new Date(outcome.measured_at).getTime();
  return age <= getSurface(card.surface ?? card.channel).ttlMs;
}

export function loopClosure(cards: readonly Card[], now: Date): LoopClosure {
  const latestCards = latestVersionPerCard(cards);
  const malformed = latestCards.filter((c) => isMalformedShip(c, now)).length;
  const eligibleCards = latestCards.filter((c) => isEligible(c, now));
  const inFlight = latestCards.filter(
    (c) => isShipped(c) && !isMalformedShip(c, now) && !isEligible(c, now),
  ).length;
  const closed = eligibleCards.filter((c) => isClosed(c, now)).length;
  const eligible = eligibleCards.length;
  return { closed, eligible, inFlight, malformed, rate: eligible === 0 ? null : closed / eligible };
}

/** Always a fraction with both integers visible. A bare percentage lies at small N. */
export function formatLoopClosure(result: LoopClosure): string {
  if (result.rate === null) return "—";
  return `${result.closed} of ${result.eligible} measured`;
}
