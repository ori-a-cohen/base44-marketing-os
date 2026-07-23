import type { Outcome, Provenance } from "../cards/schema.js";

/**
 * Import path for a gated platform's exported report (see
 * data/adapters-linkedin.md: the Marketing Developer Platform needs manual
 * approval on an undisclosed timeline, so a CSV export is the path that
 * works today). This is deliberately platform-agnostic -- the columns
 * default to the LinkedIn contract (`surface: "linkedin_ads"`,
 * `metric: "cost_per_signup"`, `unit: "usd"`) but any gated platform's
 * export can override `surface`/`metric`/`unit` per row, so the same
 * importer serves Meta or a future platform's CSV export without a new
 * code path.
 *
 * Every imported outcome is labelled `provenance: "manual"` -- never
 * "real" (no adapter fetched it automatically) and never "seeded" (a human
 * or an external tool actually measured it). This is what lets it count
 * toward the metric (see COUNTING_PROVENANCES in cards/schema.ts) while
 * staying honest that it was not measured by this system's own adapters.
 */

const REQUIRED_COLUMNS = ["utm_content", "value"] as const;

export interface CsvImportResult {
  readonly outcomes: readonly Outcome[];
  readonly matchedCount: number;
  /** A row whose utm_content is not a card this store knows about. Skipped,
   * never fabricated into a card, and reported separately from malformed --
   * a row can be perfectly well-formed and still name a card we don't have. */
  readonly unmatchedCount: number;
  /** A row that failed to parse (blank card id, non-numeric value, or an
   * unparseable measured_at). Never silently dropped -- always counted,
   * mirroring src/adapters/local-visits.ts's malformed-line convention. */
  readonly malformedCount: number;
}

/** Splits one CSV line into fields, honouring double-quoted fields that may
 * contain commas and doubled-quote escapes (`""` -> `"`). Deliberately
 * minimal -- this repo has no CSV dependency and the operator-facing format
 * (a platform's own report export) is simple tabular data, not arbitrary
 * CSV with embedded newlines inside a field. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseRows(text: string): { readonly header: readonly string[]; readonly rows: readonly string[][] } {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  if (nonBlank.length === 0) return { header: [], rows: [] };
  const [headerLine, ...rest] = nonBlank as [string, ...string[]];
  const header = splitCsvLine(headerLine).map((h) => h.trim());
  const rows = rest.map(splitCsvLine);
  return { header, rows };
}

function rowToRecord(header: readonly string[], row: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {};
  header.forEach((name, i) => {
    record[name] = (row[i] ?? "").trim();
  });
  return record;
}

/**
 * Parses a gated-platform CSV export into `Outcome`s, joining each row to a
 * known card id on `utm_content` (per data/adapters-linkedin.md). Throws
 * only for a structural problem (the required columns are absent from the
 * header entirely) -- a per-row data problem degrades into `malformedCount`
 * or `unmatchedCount` instead, matching this codebase's existing
 * degrade-and-report convention (see readVisits in local-visits.ts) rather
 * than aborting the whole import over one bad row.
 */
export function parseOutcomeCsv(
  text: string,
  knownCardIds: ReadonlySet<string>,
  now: Date = new Date(),
): CsvImportResult {
  const { header, rows } = parseRows(text);

  if (header.length > 0) {
    const missing = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
    if (missing.length > 0) {
      throw new Error(
        `CSV import is missing required column(s): ${missing.join(", ")}. ` +
          `A gated-platform export must include at least "utm_content" (the card id) and "value".`,
      );
    }
  }

  const outcomes: Outcome[] = [];
  let unmatchedCount = 0;
  let malformedCount = 0;

  for (const row of rows) {
    const record = rowToRecord(header, row);

    const cardId = record.utm_content ?? "";
    if (cardId.length === 0) {
      malformedCount += 1;
      continue;
    }

    const rawValue = record.value ?? "";
    const value = Number(rawValue);
    if (rawValue.length === 0 || !Number.isFinite(value)) {
      malformedCount += 1;
      continue;
    }

    let measuredAt = now.toISOString();
    const rawMeasuredAt = record.measured_at;
    if (rawMeasuredAt) {
      const parsed = new Date(rawMeasuredAt);
      if (Number.isNaN(parsed.getTime())) {
        malformedCount += 1;
        continue;
      }
      measuredAt = parsed.toISOString();
    }

    if (!knownCardIds.has(cardId)) {
      unmatchedCount += 1;
      continue;
    }

    const provenance: Provenance = "manual";
    outcomes.push({
      card_id: cardId,
      surface: record.surface || "linkedin_ads",
      metric: record.metric || "cost_per_signup",
      value,
      unit: record.unit || "usd",
      measured_at: measuredAt,
      source: "csv-import",
      provenance,
    });
  }

  return { outcomes, matchedCount: outcomes.length, unmatchedCount, malformedCount };
}
