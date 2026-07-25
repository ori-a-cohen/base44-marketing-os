import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readCards, upsertCard } from "../cards/store.js";
import { localVisitsAdapter, type LocalVisitsAdapter } from "./local-visits.js";
import { metaAdsAdapter, linkedInAdsAdapter } from "./stubs.js";
import type { EnvSource, OutcomeAdapter } from "./types.js";
import { parseOutcomeCsv } from "./csv-import.js";
import { loopClosure, formatLoopClosure, type LoopClosure } from "../metric/loop-closure.js";

export interface MeasureArgs {
  readonly csvPath?: string;
}

const USAGE = "usage: npm run measure [-- --csv <path>]";

/** Parses the fixed `npm run measure` / `npm run measure -- --csv <path>`
 * interface Task 19's skills already instruct operators to run. `--csv`
 * with no following value is a usage error, never a silently ignored flag. */
export function parseMeasureArgs(argv: readonly string[]): MeasureArgs {
  const idx = argv.indexOf("--csv");
  if (idx === -1) return {};
  const csvPath = argv[idx + 1];
  if (!csvPath) throw new Error(USAGE);
  return { csvPath };
}

export interface MeasureOptions {
  readonly cardsPath: string;
  readonly visitsPath: string;
  /** Path to a gated platform's exported CSV report (see
   * data/adapters-linkedin.md). Omit to skip CSV import entirely. */
  readonly csvPath?: string;
  /** Injectable environment source for the credential-gated adapters
   * (defaults to real process.env) -- lets tests exercise the cold-run,
   * zero-API-keys path deterministically. */
  readonly env?: EnvSource;
  /** Injectable clock, defaulting to the wall clock -- matches
   * localVisitsAdapter's own `fetch(cardIds, now?)` and loopClosure's `now`
   * parameter so a run is fully reproducible in tests. */
  readonly now?: Date;
}

export interface MeasureReport {
  /** Every line this run would print, in order -- returned rather than
   * written to stdout directly so tests can assert on the report's content
   * without capturing process output; the CLI entrypoint below prints
   * these verbatim. */
  readonly lines: readonly string[];
  readonly loopClosure: LoopClosure;
}

/**
 * Runs every configured outcome adapter against shipped/measured cards,
 * optionally imports a gated platform's CSV export, advances card states,
 * and reports the loop-closure rate. Never lets a seeded outcome enter the
 * metric numerator: this function never mints a "real" or "manual"
 * provenance for anything it did not itself measure (the local visits log)
 * or import (a CSV row) -- COUNTING_PROVENANCES / loopClosure (Task 9) is
 * the actual enforcement, not a convention this file could quietly bypass.
 *
 * `localVisitsAdapter`'s return type (`LocalVisitsAdapter`) is held
 * separately from the generic `OutcomeAdapter[]` list specifically so
 * `malformedCount()` stays reachable here -- holding only `OutcomeAdapter[]`
 * would erase it (see Task 10's note, carried into this task's brief).
 */
export async function runMeasure(opts: MeasureOptions): Promise<MeasureReport> {
  const now = opts.now ?? new Date();
  const lines: string[] = [];

  const cards = readCards(opts.cardsPath);
  const shipped = cards.filter((c) => c.status === "shipped" || c.status === "measured");

  // The local-visits adapter is never a stub (it needs no credentials, by
  // design -- see local-visits.ts), so it is handled on its own rather than
  // folded into the generic OutcomeAdapter[] loop below. That keeps its
  // concrete LocalVisitsAdapter type (and therefore malformedCount() and the
  // injectable clock) intact all the way through, instead of erasing it the
  // moment it sits in an OutcomeAdapter[]-typed array (Task 10's note).
  const localAdapter: LocalVisitsAdapter = localVisitsAdapter(opts.visitsPath);
  const localIds = shipped
    .filter((c) => (c.surface ?? c.channel) === localAdapter.surface)
    .map((c) => c.id);
  if (localIds.length > 0) {
    for (const outcome of await localAdapter.fetch(localIds, now)) {
      const card = shipped.find((c) => c.id === outcome.card_id);
      if (!card) continue;
      upsertCard(opts.cardsPath, {
        ...card,
        status: "measured",
        outcome,
        history: [...card.history, `measured via ${localAdapter.id}: ${outcome.value} ${outcome.unit}`],
      });
    }
    lines.push(`OK   ${localAdapter.id}: measured ${localIds.length} card(s)`);
  }

  // The credential-gated adapters share the plain OutcomeAdapter contract
  // uniformly -- neither needs an injected clock or exposes anything beyond
  // fetch()/status, so a generic loop over readonly OutcomeAdapter[] is the
  // right shape here (unlike the local adapter above).
  const gatedAdapters: readonly OutcomeAdapter[] = [metaAdsAdapter(opts.env), linkedInAdsAdapter(opts.env)];
  for (const adapter of gatedAdapters) {
    if (adapter.status === "stub") {
      lines.push(`SKIP ${adapter.id}: ${adapter.unavailableReason ?? "not configured"}`);
      continue;
    }
    const ids = shipped.filter((c) => (c.surface ?? c.channel) === adapter.surface).map((c) => c.id);
    if (ids.length === 0) continue;

    for (const outcome of await adapter.fetch(ids)) {
      const card = shipped.find((c) => c.id === outcome.card_id);
      if (!card) continue;
      upsertCard(opts.cardsPath, {
        ...card,
        status: "measured",
        outcome,
        history: [...card.history, `measured via ${adapter.id}: ${outcome.value} ${outcome.unit}`],
      });
    }
    lines.push(`OK   ${adapter.id}: measured ${ids.length} card(s)`);
  }

  const malformedVisits = localAdapter.malformedCount();
  if (malformedVisits > 0) {
    const noun = malformedVisits === 1 ? "line" : "lines";
    lines.push(`NOTE local-visits: ${malformedVisits} malformed ${noun} in the visit log were skipped`);
  }

  if (opts.csvPath) {
    if (!existsSync(opts.csvPath)) {
      throw new Error(`--csv path not found: ${opts.csvPath}`);
    }
    const csvText = readFileSync(opts.csvPath, "utf8");
    const knownIds = new Set(shipped.map((c) => c.id));
    const imported = parseOutcomeCsv(csvText, knownIds, now);

    for (const outcome of imported.outcomes) {
      const card = shipped.find((c) => c.id === outcome.card_id);
      if (!card) continue;
      upsertCard(opts.cardsPath, {
        ...card,
        status: "measured",
        outcome,
        history: [...card.history, `measured via csv-import (${opts.csvPath}): ${outcome.value} ${outcome.unit}`],
      });
    }

    lines.push(
      `OK   csv-import: imported ${imported.matchedCount} card(s) from ${opts.csvPath}` +
        ` (${imported.unmatchedCount} unmatched, ${imported.malformedCount} malformed)`,
    );
  }

  const result = loopClosure(readCards(opts.cardsPath), now);
  lines.push("");
  lines.push(`Loop-closure rate: ${formatLoopClosure(result)}  (${result.inFlight} in flight)`);

  return { lines, loopClosure: result };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

/** Wraps arg parsing and runMeasure in one async body so a synchronous usage
 * error (a malformed --csv flag) is caught by the same .catch() as any
 * runtime failure, instead of surfacing as an uncaught exception with a raw
 * stack trace. */
async function main(): Promise<void> {
  const cardsPath = process.env.CARDS_PATH ?? "data/cards.jsonl";
  const visitsPath = process.env.VISITS_PATH ?? "data/visits.jsonl";
  const { csvPath } = parseMeasureArgs(process.argv.slice(2));
  const report = await runMeasure({ cardsPath, visitsPath, csvPath });
  for (const line of report.lines) process.stdout.write(`${line}\n`);
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`measure: ${message}\n`);
    process.exit(1);
  });
}
