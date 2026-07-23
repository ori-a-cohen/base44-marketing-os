import { describe, it, expect } from "vitest";
import { parseOutcomeCsv } from "../../src/adapters/csv-import.js";
import { COUNTING_PROVENANCES } from "../../src/cards/schema.js";

const knownCardIds = new Set(["cc-100", "cc-200"]);
const now = new Date("2026-07-23T00:00:00.000Z");

describe("parseOutcomeCsv", () => {
  it("matches rows to known cards on utm_content and labels provenance manual", () => {
    const csv = "utm_content,value\ncc-100,32.5\n";
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      card_id: "cc-100",
      surface: "linkedin_ads",
      metric: "cost_per_signup",
      value: 32.5,
      unit: "usd",
      provenance: "manual",
      source: "csv-import",
    });
  });

  it("never emits a seeded provenance -- imported rows are always manual", () => {
    const csv = "utm_content,value\ncc-100,10\ncc-200,20\n";
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.outcomes.every((o) => o.provenance === "manual")).toBe(true);
    expect(result.outcomes.every((o) => COUNTING_PROVENANCES.includes(o.provenance))).toBe(true);
  });

  it("respects an explicit surface/metric/unit override per row", () => {
    const csv = "utm_content,value,surface,metric,unit\ncc-100,4.2,meta_ads,cost_per_signup,usd\n";
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.outcomes[0]?.surface).toBe("meta_ads");
  });

  it("uses a provided measured_at when parseable, otherwise the injected clock", () => {
    const csv = "utm_content,value,measured_at\ncc-100,1,2026-01-01T00:00:00.000Z\n";
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.outcomes[0]?.measured_at).toBe("2026-01-01T00:00:00.000Z");

    const csvNoDate = "utm_content,value\ncc-100,1\n";
    const resultNoDate = parseOutcomeCsv(csvNoDate, knownCardIds, now);
    expect(resultNoDate.outcomes[0]?.measured_at).toBe(now.toISOString());
  });

  it("counts an unmatched card id separately from malformed rows, and skips it", () => {
    const csv = "utm_content,value\ncc-999,10\n";
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.outcomes).toHaveLength(0);
    expect(result.unmatchedCount).toBe(1);
    expect(result.malformedCount).toBe(0);
  });

  it("counts a non-numeric value as malformed, never as a zero measurement", () => {
    const csv = "utm_content,value\ncc-100,not-a-number\n";
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.outcomes).toHaveLength(0);
    expect(result.malformedCount).toBe(1);
  });

  it("counts a blank utm_content as malformed", () => {
    const csv = "utm_content,value\n,10\n";
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.malformedCount).toBe(1);
  });

  it("counts an unparseable measured_at as malformed", () => {
    const csv = "utm_content,value,measured_at\ncc-100,10,not-a-date\n";
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.malformedCount).toBe(1);
    expect(result.outcomes).toHaveLength(0);
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'utm_content,value,metric\ncc-100,10,"cost, per signup"\n';
    const result = parseOutcomeCsv(csv, knownCardIds, now);
    expect(result.outcomes[0]?.metric).toBe("cost, per signup");
  });

  it("throws a clear, structural error when required columns are absent from the header", () => {
    expect(() => parseOutcomeCsv("card,amount\ncc-100,10\n", knownCardIds, now)).toThrow(/utm_content/);
  });

  it("returns zero outcomes, zero counts for an empty (header-only) CSV", () => {
    const result = parseOutcomeCsv("utm_content,value\n", knownCardIds, now);
    expect(result.outcomes).toEqual([]);
    expect(result.malformedCount).toBe(0);
    expect(result.unmatchedCount).toBe(0);
  });
});
