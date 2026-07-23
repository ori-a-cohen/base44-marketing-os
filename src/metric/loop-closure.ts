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
 * The two rows that matter for a logical card id, and why they differ.
 *
 * `latestShipped` answers "has this work actually shipped, and how long ago" --
 * it is the highest-version row that ever reached shipped/measured status, so a
 * v1 that shipped and was never measured does not lose its place in the
 * denominator just because `nextVersion` drafted a v2 on top of it.
 *
 * `latestOverall` answers "what is the current live artifact" -- it is the
 * highest version regardless of status, so a regenerated v2 must earn its own
 * outcome and can never inherit a predecessor's measurement.
 *
 * Ties on version (a duplicate append, or a corrected re-write of the same
 * version) resolve to the last row seen, since later rows are more recent in
 * an append-only log. Rows may appear out of order in the file.
 */
interface CardRows {
  readonly latestOverall: Card;
  readonly latestShipped: Card | null;
}

function pickLatest(rows: readonly Card[]): Card {
  return rows.reduce((winner, row) => (row.version >= winner.version ? row : winner));
}

function latestShippedOf(rows: readonly Card[]): Card | null {
  const shippedRows = rows.filter((r) => r.status === "shipped" || r.status === "measured");
  return shippedRows.length === 0 ? null : pickLatest(shippedRows);
}

/** Groups the log by logical card id and resolves the two rows described above for each. */
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
    latestShipped: latestShippedOf(rows),
  }));
}

function elapsedSinceShip(shippedAt: string, now: Date): number {
  return now.getTime() - new Date(shippedAt).getTime();
}

type ShipShape = "malformed" | "in-flight" | "mature";

/**
 * Classifies a row already known to have shipped/measured status. A null or
 * unparseable shipped_at is the same corruption `malformed` exists to surface
 * -- it must never fall through into "in flight" (Fix 3a).
 */
function shipShapeOf(shippedRow: Card, now: Date): ShipShape {
  if (shippedRow.shipped_at === null) return "malformed";
  const elapsed = elapsedSinceShip(shippedRow.shipped_at, now);
  if (Number.isNaN(elapsed)) return "malformed";
  return elapsed >= getSurface(shippedRow.surface ?? shippedRow.channel).tMatureMs ? "mature" : "in-flight";
}

/**
 * Rules 1, 2 and 4, plus Fix 2. An eligible card is closed only when its
 * current live row (latestOverall) carries an outcome that: belongs to it
 * (card_id must match -- outcomes get copied between cards by hand), was
 * measured at or after that same row's own ship instant (a pre-ship
 * measurement is not "we shipped it and then measured what happened"), has a
 * countable provenance (seeded never counts), a finite value (a value of 0 is
 * a measurement; Infinity is not), and is still fresh against the TTL.
 */
function isClosed(card: Card, now: Date): boolean {
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

  for (const { latestOverall, latestShipped } of groupLatestByCard(cards)) {
    if (latestShipped === null) continue; // never shipped: contributes to nothing

    const shape = shipShapeOf(latestShipped, now);
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
