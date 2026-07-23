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
 * The rows that matter for a logical card id, and why they differ.
 *
 * `shippedRows` answers "has this work actually shipped, and how long ago" --
 * for EVERY row that ever reached shipped/measured status. Eligibility is a
 * property of the card's whole shipped history, not of one row: if any
 * shipped version has matured, the card is eligible, so a v1 that shipped and
 * was never measured cannot be pushed out of the denominator merely because
 * `nextVersion` drafted (or re-shipped) a v2 on top of it, and a corrupt
 * newest shipped row can never mask a well-formed earlier one.
 *
 * `latestOverall` answers "what is the current live artifact" -- it is the
 * highest version regardless of status, so a regenerated v2 must earn its own
 * outcome and can never inherit a predecessor's measurement. Closure is
 * therefore judged from a different row than eligibility: eligibility scans
 * every shipped row, closure reads only the single latest row overall. This
 * also means maturity is judged against each shipped row's own surface, while
 * the TTL check in isClosed is judged against latestOverall's surface -- a
 * regeneration that changes surface changes the freshness window for a card
 * whose maturity was already judged under the old surface.
 *
 * Ties on version (a duplicate append, or a corrected re-write of the same
 * version) resolve to the last row seen, since later rows are more recent in
 * an append-only log. Rows may appear out of order in the file.
 */
interface CardRows {
  readonly latestOverall: Card;
  readonly shippedRows: readonly Card[];
}

function pickLatest(rows: readonly Card[]): Card {
  return rows.reduce((winner, row) => (row.version >= winner.version ? row : winner));
}

/** Groups the log by logical card id and resolves the rows described above for each. */
function groupLatestByCard(cards: readonly Card[]): readonly CardRows[] {
  const rowsById = new Map<string, Card[]>();
  for (const card of cards) {
    const existing = rowsById.get(card.id);
    if (existing === undefined) {
      rowsById.set(card.id, [card]);
    } else {
      existing.push(card);
    }
  }
  return [...rowsById.values()].map((rows) => ({
    latestOverall: pickLatest(rows),
    shippedRows: rows.filter((r) => r.status === "shipped" || r.status === "measured"),
  }));
}

function elapsedSinceShip(shippedAt: string, now: Date): number {
  return now.getTime() - new Date(shippedAt).getTime();
}

type ShipShape = "malformed" | "in-flight" | "mature";

/**
 * Classifies a single row already known to have shipped/measured status. A
 * null or unparseable shipped_at is the same corruption `malformed` exists to
 * surface -- it must never fall through into "in flight".
 */
function rowShipShape(row: Card, now: Date): ShipShape {
  if (row.shipped_at === null) return "malformed";
  const elapsed = elapsedSinceShip(row.shipped_at, now);
  if (Number.isNaN(elapsed)) return "malformed";
  return elapsed >= getSurface(row.surface ?? row.channel).tMatureMs ? "mature" : "in-flight";
}

/**
 * Fix 1: eligibility is a property of the card's full shipped history. If any
 * shipped row has matured, the card is eligible -- a re-ship that resets the
 * clock on the newest row cannot undo an earlier row's maturity, and a
 * corrupt newest row cannot mask a well-formed earlier one. Only when no
 * shipped row has matured do we fall back to whether any shipped row is at
 * least well-formed (in flight); the card is malformed only when every
 * shipped row is unreadable.
 */
function shipHistoryShapeOf(shippedRows: readonly Card[], now: Date): ShipShape {
  const shapes = shippedRows.map((row) => rowShipShape(row, now));
  if (shapes.some((shape) => shape === "mature")) return "mature";
  if (shapes.some((shape) => shape === "in-flight")) return "in-flight";
  return "malformed";
}

/**
 * Rules 1, 2 and 4, plus Fix 2 (round 2) and Fix 2 (round 3). An eligible
 * card is closed only when its current live row (latestOverall) has itself
 * reached shipped/measured status -- a hand-edited row can carry a leftover
 * shipped_at and outcome after being reverted to "drafted" (or a legacy
 * "review"/"draft"), and that must not close the loop -- and that row carries
 * an outcome that: belongs to it (card_id must match -- outcomes get copied
 * between cards by hand), was measured at or after that same row's own ship
 * instant (a pre-ship measurement is not "we shipped it and then measured
 * what happened"), has a countable provenance (seeded never counts), a finite
 * value (a value of 0 is a measurement; Infinity is not), and is still fresh
 * against the TTL.
 */
function isClosed(card: Card, now: Date): boolean {
  if (card.status !== "shipped" && card.status !== "measured") return false;
  const outcome = card.outcome;
  if (outcome === null) return false;
  if (outcome.card_id !== card.id) return false;
  if (card.shipped_at === null) return false;
  const shippedAtMs = new Date(card.shipped_at).getTime();
  const measuredAtMs = new Date(outcome.measured_at).getTime();
  if (Number.isNaN(shippedAtMs) || Number.isNaN(measuredAtMs)) return false;
  if (measuredAtMs < shippedAtMs) return false;
  if (!Number.isFinite(outcome.value)) return false;
  if (!COUNTING_PROVENANCES.includes(outcome.provenance)) return false;
  const age = now.getTime() - measuredAtMs;
  return age <= getSurface(card.surface ?? card.channel).ttlMs;
}

export function loopClosure(cards: readonly Card[], now: Date): LoopClosure {
  let malformed = 0;
  let inFlight = 0;
  let eligible = 0;
  let closed = 0;

  for (const { latestOverall, shippedRows } of groupLatestByCard(cards)) {
    if (shippedRows.length === 0) continue; // never shipped: contributes to nothing

    const shape = shipHistoryShapeOf(shippedRows, now);
    if (shape === "malformed") {
      malformed += 1;
      continue;
    }
    if (shape === "in-flight") {
      inFlight += 1;
      continue;
    }

    eligible += 1;
    if (isClosed(latestOverall, now)) closed += 1;
  }

  return { closed, eligible, inFlight, malformed, rate: eligible === 0 ? null : closed / eligible };
}

/**
 * Always a fraction with both integers visible. A bare percentage lies at
 * small N. When malformed cards have shrunk the denominator, say so -- a
 * shrinking denominator must never be invisible to the human reading it.
 */
export function formatLoopClosure(result: LoopClosure): string {
  const base = result.rate === null ? "—" : `${result.closed} of ${result.eligible} measured`;
  if (result.malformed === 0) return base;
  const noun = result.malformed === 1 ? "an unreadable ship time" : "unreadable ship times";
  return `${base} (${result.malformed} with ${noun})`;
}
