import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Outcome } from "../cards/schema.js";
import type { OutcomeAdapter } from "./types.js";

export interface Visit {
  readonly card_id: string;
  readonly at: string;
  readonly kind: "view" | "click";
}

const VISIT_KINDS = ["view", "click"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates a parsed JSON value as a genuine Visit, mirroring parseCard's
 * shape checks (src/cards/schema.ts). A syntactically valid but semantically
 * fabricated line -- a non-string card_id, a kind outside the "view" |
 * "click" union, a non-string or unparseable at -- is rejected here rather
 * than silently accepted and counted as a real visit. Returns null (never
 * throws) so the caller can fold rejection into the same malformed count as
 * a JSON parse failure. Unknown extra fields are dropped, not rejected: the
 * returned record carries only the three fields Visit defines.
 */
export function parseVisit(raw: unknown): Visit | null {
  if (!isRecord(raw)) return null;

  const card_id = raw.card_id;
  if (typeof card_id !== "string" || card_id.length === 0) return null;

  const kind = raw.kind;
  if (typeof kind !== "string" || !(VISIT_KINDS as readonly string[]).includes(kind)) return null;

  const at = raw.at;
  if (typeof at !== "string" || Number.isNaN(new Date(at).getTime())) return null;

  return { card_id, at, kind: kind as Visit["kind"] };
}

export function recordVisit(path: string, visit: Visit): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(visit)}\n`, "utf8");
}

export interface ReadVisitsResult {
  readonly visits: readonly Visit[];
  /** Lines that failed to parse as JSON or failed parseVisit's shape checks. Never silently dropped. */
  readonly malformed: number;
}

/**
 * Reads every visit in the log, skipping (rather than throwing on) a
 * malformed or fabricated line so one bad row cannot take down every other
 * card's count. The skip is never silent: every skipped line is counted and
 * returned alongside the visits that did parse, so a caller can report a
 * shrinking log rather than hide it.
 */
export function readVisits(path: string): ReadVisitsResult {
  if (!existsSync(path)) return { visits: [], malformed: 0 };

  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const visits: Visit[] = [];
  let malformed = 0;

  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    const visit = parseVisit(raw);
    if (visit === null) {
      malformed += 1;
    } else {
      visits.push(visit);
    }
  }

  return { visits, malformed };
}

/**
 * The cold-run adapter. A clone serves its own generated pages and logs its own
 * traffic, so an evaluator closes the loop with their own real behaviour and
 * zero API keys. Provenance is "real" because these are genuine events.
 *
 * `fetch`'s second parameter is an injected clock, defaulting to the wall
 * clock, so callers (and tests) can pin `measured_at` to a known instant
 * instead of racing real time -- matching how `loopClosure` takes `now`
 * explicitly (src/metric/loop-closure.ts).
 *
 * Alongside the OutcomeAdapter contract, this adapter also exposes
 * `malformedCount`, a fresh re-read of the log's malformed-line count as of
 * now. It is not tied to the most recent `fetch` call (there is no cached
 * state to go stale); it lets a caller such as the future measure CLI
 * (Task 20) surface how many rows were unreadable without changing the
 * shared OutcomeAdapter#fetch signature that every adapter must satisfy.
 */
export type LocalVisitsAdapter = Omit<OutcomeAdapter, "fetch"> & {
  /** cardIds as the OutcomeAdapter contract requires, plus an optional injected clock for tests. */
  fetch(cardIds: readonly string[], now?: Date): Promise<Outcome[]>;
  malformedCount(): number;
};

export function localVisitsAdapter(path: string): LocalVisitsAdapter {
  return {
    id: "local-visits",
    surface: "landing_page",
    status: "live",
    async fetch(cardIds, now = new Date()) {
      const { visits } = readVisits(path);
      const measuredAt = now.toISOString();
      return cardIds.map((card_id): Outcome => ({
        card_id,
        surface: "landing_page",
        metric: "visits",
        // "view" and "click" are deliberately summed into one "visits" count;
        // they are not separately queryable through this metric.
        value: visits.filter((v) => v.card_id === card_id).length,
        unit: "count",
        measured_at: measuredAt,
        source: "local-visits",
        provenance: "real",
      }));
    },
    malformedCount() {
      return readVisits(path).malformed;
    },
  };
}
