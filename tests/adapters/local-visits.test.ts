import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordVisit, localVisitsAdapter, readVisits, parseVisit } from "../../src/adapters/local-visits.js";

let file: string;
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rt-v-")); file = join(dir, "visits.jsonl"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("local visit logger", () => {
  it("returns an outcome with value 0 for a card with no visits", async () => {
    const outcomes = await localVisitsAdapter(file).fetch(["cc-1"]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.value).toBe(0);
    expect(outcomes[0]?.provenance).toBe("real");
  });

  it("counts recorded views", async () => {
    recordVisit(file, { card_id: "cc-1", at: new Date().toISOString(), kind: "view" });
    recordVisit(file, { card_id: "cc-1", at: new Date().toISOString(), kind: "view" });
    recordVisit(file, { card_id: "cc-2", at: new Date().toISOString(), kind: "view" });
    const outcomes = await localVisitsAdapter(file).fetch(["cc-1"]);
    expect(outcomes[0]?.value).toBe(2);
  });

  it("marks outcomes as real, never seeded", async () => {
    recordVisit(file, { card_id: "cc-1", at: new Date().toISOString(), kind: "click" });
    const outcomes = await localVisitsAdapter(file).fetch(["cc-1"]);
    expect(outcomes[0]?.provenance).toBe("real");
    expect(outcomes[0]?.source).toBe("local-visits");
  });

  it("declares itself a live surface adapter needing no credentials", () => {
    expect(localVisitsAdapter(file).status).toBe("live");
  });

  it("accepts an injected clock for measured_at instead of the wall clock", async () => {
    const pinned = new Date("2026-01-01T00:00:00.000Z");
    const outcomes = await localVisitsAdapter(file).fetch(["cc-1"], pinned);
    expect(outcomes[0]?.measured_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("malformed visit lines", () => {
  it("skips a single malformed line without breaking other cards' counts", async () => {
    recordVisit(file, { card_id: "cc-1", at: new Date().toISOString(), kind: "view" });
    appendFileSync(file, "not json at all\n", "utf8");
    recordVisit(file, { card_id: "cc-2", at: new Date().toISOString(), kind: "view" });

    const adapter = localVisitsAdapter(file);
    const outcomes = await adapter.fetch(["cc-1", "cc-2"]);
    expect(outcomes.find((o) => o.card_id === "cc-1")?.value).toBe(1);
    expect(outcomes.find((o) => o.card_id === "cc-2")?.value).toBe(1);
  });

  it("counts a malformed line rather than silently dropping it", async () => {
    recordVisit(file, { card_id: "cc-1", at: new Date().toISOString(), kind: "view" });
    appendFileSync(file, "not json at all\n", "utf8");

    const adapter = localVisitsAdapter(file);
    expect(adapter.malformedCount()).toBe(1);
  });

  it("counts a fabricated-but-valid-JSON record as malformed, not as a visit", async () => {
    appendFileSync(file, `${JSON.stringify({ card_id: 42, at: "not-a-date", kind: "bogus" })}\n`, "utf8");

    const adapter = localVisitsAdapter(file);
    const outcomes = await adapter.fetch(["cc-1"]);
    expect(outcomes[0]?.value).toBe(0);
    expect(adapter.malformedCount()).toBe(1);
  });

  it("readVisits reports zero malformed lines for a clean log", () => {
    recordVisit(file, { card_id: "cc-1", at: new Date().toISOString(), kind: "view" });
    expect(readVisits(file).malformed).toBe(0);
  });
});

describe("parseVisit", () => {
  it("rejects a non-string card_id", () => {
    expect(parseVisit({ card_id: 42, at: new Date().toISOString(), kind: "view" })).toBeNull();
  });

  it("rejects a kind outside the view|click union", () => {
    expect(parseVisit({ card_id: "cc-1", at: new Date().toISOString(), kind: "purchase" })).toBeNull();
  });

  it("rejects a non-string at", () => {
    expect(parseVisit({ card_id: "cc-1", at: 12345, kind: "view" })).toBeNull();
  });

  it("rejects an unparseable at", () => {
    expect(parseVisit({ card_id: "cc-1", at: "not-a-date", kind: "view" })).toBeNull();
  });

  it("rejects a non-object value", () => {
    expect(parseVisit("cc-1")).toBeNull();
    expect(parseVisit(null)).toBeNull();
    expect(parseVisit(["cc-1"])).toBeNull();
  });

  it("passes a valid record through unchanged", () => {
    const valid = { card_id: "cc-1", at: "2026-01-01T00:00:00.000Z", kind: "click" as const };
    expect(parseVisit(valid)).toEqual(valid);
  });
});
