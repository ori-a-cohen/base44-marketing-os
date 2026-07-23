import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordVisit, localVisitsAdapter } from "../../src/adapters/local-visits.js";

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
});
