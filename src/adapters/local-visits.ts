import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Outcome } from "../cards/schema.js";
import type { OutcomeAdapter } from "./types.js";

export interface Visit {
  readonly card_id: string;
  readonly at: string;
  readonly kind: "view" | "click";
}

export function recordVisit(path: string, visit: Visit): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(visit)}\n`, "utf8");
}

export function readVisits(path: string): Visit[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Visit);
}

/**
 * The cold-run adapter. A clone serves its own generated pages and logs its own
 * traffic, so an evaluator closes the loop with their own real behaviour and
 * zero API keys. Provenance is "real" because these are genuine events.
 */
export function localVisitsAdapter(path: string): OutcomeAdapter {
  return {
    id: "local-visits",
    surface: "landing_page",
    status: "live",
    async fetch(cardIds) {
      const visits = readVisits(path);
      const now = new Date().toISOString();
      return cardIds.map((card_id): Outcome => ({
        card_id,
        surface: "landing_page",
        metric: "visits",
        value: visits.filter((v) => v.card_id === card_id).length,
        unit: "count",
        measured_at: now,
        source: "local-visits",
        provenance: "real",
      }));
    },
  };
}
