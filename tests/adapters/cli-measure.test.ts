import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMeasureArgs, runMeasure } from "../../src/adapters/cli-measure.js";
import { recordVisit } from "../../src/adapters/local-visits.js";
import { readCards } from "../../src/cards/store.js";
import { parseCard } from "../../src/cards/schema.js";
import { COUNTING_PROVENANCES } from "../../src/cards/schema.js";

const NOW = new Date("2026-07-23T12:00:00.000Z");

let dir: string;
let cardsPath: string;
let visitsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-m-"));
  cardsPath = join(dir, "cards.jsonl");
  visitsPath = join(dir, "visits.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeCards(cards: unknown[]): void {
  writeFileSync(cardsPath, cards.map((c) => JSON.stringify(c)).join("\n") + "\n");
}

const shippedLongAgo = (id: string, extra: Record<string, unknown> = {}) =>
  parseCard({
    id,
    channel: "landing_page",
    surface: "landing_page",
    topic: "Base1",
    status: "shipped",
    created: "2026-07-01",
    shipped_at: new Date(NOW.getTime() - 48 * 3_600_000).toISOString(),
    ...extra,
  });

describe("parseMeasureArgs", () => {
  it("defaults to no csv path when --csv is absent", () => {
    expect(parseMeasureArgs([])).toEqual({});
  });

  it("reads --csv <path>", () => {
    expect(parseMeasureArgs(["--csv", "report.csv"])).toEqual({ csvPath: "report.csv" });
  });

  it("throws a usage error when --csv has no value", () => {
    expect(() => parseMeasureArgs(["--csv"])).toThrow(/--csv/);
  });
});

describe("runMeasure: local visits (cold run, zero API keys)", () => {
  it("measures a shipped card's real local visits and advances it to measured", async () => {
    writeCards([shippedLongAgo("cc-1")]);
    recordVisit(visitsPath, { card_id: "cc-1", at: NOW.toISOString(), kind: "view" });

    const report = await runMeasure({ cardsPath, visitsPath, env: {}, now: NOW });

    const card = readCards(cardsPath).find((c) => c.id === "cc-1");
    expect(card?.status).toBe("measured");
    expect(card?.outcome?.provenance).toBe("real");
    expect(card?.outcome?.value).toBe(1);
    expect(report.loopClosure.eligible).toBeGreaterThanOrEqual(1);
  });

  it("records a zero-visit outcome as a real measurement, not a null/skip", async () => {
    writeCards([shippedLongAgo("cc-1")]);
    await runMeasure({ cardsPath, visitsPath, env: {}, now: NOW });
    const card = readCards(cardsPath).find((c) => c.id === "cc-1");
    expect(card?.outcome?.value).toBe(0);
    expect(card?.outcome?.provenance).toBe("real");
  });

  it("degrades to the local adapter with no adapters configured, never throwing (stub surfaces skip silently)", async () => {
    writeCards([shippedLongAgo("cc-1")]);
    await expect(runMeasure({ cardsPath, visitsPath, env: {}, now: NOW })).resolves.toBeDefined();
  });

  it("surfaces the local visits logger's malformed-line count", async () => {
    writeCards([shippedLongAgo("cc-1")]);
    writeFileSync(visitsPath, "not json at all\n");
    const report = await runMeasure({ cardsPath, visitsPath, env: {}, now: NOW });
    expect(report.lines.join("\n")).toMatch(/malformed/i);
    expect(report.lines.join("\n")).toContain("1");
  });
});

describe("runMeasure: seeded outcomes never enter the numerator", () => {
  it("a pre-existing seeded outcome on an unconfigured stub surface is left alone and stays excluded from closure", async () => {
    writeCards([
      shippedLongAgo("cc-2", {
        surface: "linkedin_ads",
        status: "measured",
        outcome: {
          card_id: "cc-2",
          surface: "linkedin_ads",
          metric: "cost_per_signup",
          value: 12,
          unit: "usd",
          measured_at: NOW.toISOString(),
          source: "seed-data",
          provenance: "seeded",
        },
      }),
    ]);

    const report = await runMeasure({ cardsPath, visitsPath, env: {}, now: NOW });

    const card = readCards(cardsPath).find((c) => c.id === "cc-2");
    // The stub adapter never fetched for this surface, so the seeded row is
    // untouched -- but it must never be counted as closed regardless.
    expect(card?.outcome?.provenance).toBe("seeded");
    expect(report.loopClosure.closed).toBe(0);
  });

  it("a --csv import can replace a seeded placeholder with a real, countable manual outcome", async () => {
    writeCards([
      shippedLongAgo("cc-3", {
        surface: "linkedin_ads",
        status: "measured",
        outcome: {
          card_id: "cc-3",
          surface: "linkedin_ads",
          metric: "cost_per_signup",
          value: 999,
          unit: "usd",
          measured_at: NOW.toISOString(),
          source: "seed-data",
          provenance: "seeded",
        },
      }),
    ]);
    const csvPath = join(dir, "report.csv");
    writeFileSync(csvPath, "utm_content,value\ncc-3,18.5\n");

    const report = await runMeasure({ cardsPath, visitsPath, csvPath, env: {}, now: NOW });

    const card = readCards(cardsPath).find((c) => c.id === "cc-3");
    expect(card?.outcome?.provenance).toBe("manual");
    expect(card?.outcome?.value).toBe(18.5);
    expect(COUNTING_PROVENANCES.includes(card!.outcome!.provenance)).toBe(true);
    expect(report.loopClosure.closed).toBe(1);
  });

  it("a csv row for an id the store does not know about is skipped, never fabricating a card", async () => {
    writeCards([shippedLongAgo("cc-4")]);
    const csvPath = join(dir, "report.csv");
    writeFileSync(csvPath, "utm_content,value\ncc-does-not-exist,5\n");

    await runMeasure({ cardsPath, visitsPath, csvPath, env: {}, now: NOW });
    expect(readCards(cardsPath)).toHaveLength(1);
  });
});

describe("runMeasure: --csv error handling", () => {
  it("throws a clear error when the csv path does not exist", async () => {
    writeCards([shippedLongAgo("cc-1")]);
    await expect(
      runMeasure({ cardsPath, visitsPath, csvPath: join(dir, "nope.csv"), env: {}, now: NOW }),
    ).rejects.toThrow(/nope\.csv/);
  });
});

describe("runMeasure: reporting", () => {
  it("reports the loop-closure rate as a fraction with N, never a bare percentage", async () => {
    writeCards([shippedLongAgo("cc-1")]);
    recordVisit(visitsPath, { card_id: "cc-1", at: NOW.toISOString(), kind: "view" });
    const report = await runMeasure({ cardsPath, visitsPath, env: {}, now: NOW });
    expect(report.lines.join("\n")).toMatch(/\d+ of \d+ measured/);
  });
});
