import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCards, appendCard, upsertCard, nextVersion } from "../../src/cards/store.js";
import { parseCard } from "../../src/cards/schema.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-"));
  file = join(dir, "cards.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = (id: string) =>
  parseCard({ id, channel: "landing_page", topic: "Base1", status: "drafted", created: "2026-07-23" });

describe("card store", () => {
  it("returns an empty array when the file does not exist", () => {
    expect(readCards(file)).toEqual([]);
  });

  it("appends and reads back a card", () => {
    appendCard(file, base("cc-1"));
    const cards = readCards(file);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe("cc-1");
  });

  it("skips blank lines", () => {
    writeFileSync(file, "\n\n");
    expect(readCards(file)).toEqual([]);
  });

  it("upsert replaces the card with the same id and version", () => {
    appendCard(file, base("cc-1"));
    upsertCard(file, { ...base("cc-1"), status: "approved" });
    const cards = readCards(file);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.status).toBe("approved");
  });

  it("nextVersion bumps the version and records history", () => {
    const v2 = nextVersion(base("cc-1"));
    expect(v2.version).toBe(2);
    expect(v2.history.at(-1)).toContain("version 2");
  });

  it("keeps both versions side by side after upsert of a bumped card", () => {
    appendCard(file, base("cc-1"));
    appendCard(file, nextVersion(base("cc-1")));
    expect(readCards(file)).toHaveLength(2);
  });

  it("leaves no temp file behind after a successful upsert", () => {
    appendCard(file, base("cc-1"));
    upsertCard(file, { ...base("cc-1"), status: "approved" });
    expect(readdirSync(dir)).toEqual(["cards.jsonl"]);
  });
});
