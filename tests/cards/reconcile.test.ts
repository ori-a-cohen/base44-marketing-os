import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile, findVerdictsWithoutCards } from "../../src/cards/reconcile.js";
import { readCards } from "../../src/cards/store.js";
import { parseCard } from "../../src/cards/schema.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rt-r-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const transcriptWith = (text: string) =>
  [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })].join("\n");

describe("reconcile", () => {
  it("creates a card for a guardian verdict that produced none", () => {
    const t = join(dir, "t.jsonl");
    const c = join(dir, "cards.jsonl");
    writeFileSync(t, transcriptWith("VERDICT: APPROVED score 9.5 card-id: cc-42 channel: landing_page"));
    const result = reconcile(t, c);
    expect(result.created).toContain("cc-42");
    expect(readCards(c).map((x) => x.id)).toContain("cc-42");
  });

  it("does not duplicate a card that already exists", () => {
    const t = join(dir, "t.jsonl");
    const c = join(dir, "cards.jsonl");
    writeFileSync(c, JSON.stringify({
      id: "cc-42", channel: "landing_page", topic: "Base1", status: "approved", created: "2026-07-23",
    }) + "\n");
    writeFileSync(t, transcriptWith("VERDICT: APPROVED score 9.5 card-id: cc-42 channel: landing_page"));
    expect(reconcile(t, c).created).toEqual([]);
    expect(readCards(c)).toHaveLength(1);
  });

  it("returns nothing for a transcript with no verdict", () => {
    const t = join(dir, "t.jsonl");
    writeFileSync(t, transcriptWith("Just chatting about the weather."));
    expect(reconcile(t, join(dir, "cards.jsonl")).created).toEqual([]);
  });

  it("tolerates a missing transcript file", () => {
    expect(reconcile(join(dir, "nope.jsonl"), join(dir, "cards.jsonl")).created).toEqual([]);
  });

  it("re-running reconcile on the same transcript is idempotent (no duplicate cards)", () => {
    const t = join(dir, "t.jsonl");
    const c = join(dir, "cards.jsonl");
    writeFileSync(t, transcriptWith("VERDICT: APPROVED score 9.5 card-id: cc-77 channel: landing_page"));
    const first = reconcile(t, c);
    const second = reconcile(t, c);
    expect(first.created).toEqual(["cc-77"]);
    expect(second.created).toEqual([]);
    expect(readCards(c)).toHaveLength(1);
  });

  it("creates one card per distinct verdict when multiple appear in one transcript", () => {
    const t = join(dir, "t.jsonl");
    const c = join(dir, "cards.jsonl");
    writeFileSync(
      t,
      transcriptWith(
        "VERDICT: APPROVED score 9.5 card-id: cc-1 channel: landing_page\n" +
          "VERDICT: REJECTED score 6 card-id: cc-2 channel: email",
      ),
    );
    const result = reconcile(t, c);
    expect([...result.created].sort()).toEqual(["cc-1", "cc-2"]);
    expect(readCards(c)).toHaveLength(2);
    const cc2 = readCards(c).find((x) => x.id === "cc-2");
    expect(cc2?.status).toBe("drafted");
  });

  it("does not re-create a card for a repeated verdict id within the same transcript", () => {
    const t = join(dir, "t.jsonl");
    const c = join(dir, "cards.jsonl");
    writeFileSync(
      t,
      transcriptWith(
        "VERDICT: REJECTED score 6 card-id: cc-9 channel: email\n" +
          "VERDICT: APPROVED score 9 card-id: cc-9 channel: email",
      ),
    );
    const result = reconcile(t, c);
    expect(result.created).toEqual(["cc-9"]);
    expect(readCards(c)).toHaveLength(1);
  });

  it("tolerates a malformed line in the transcript (bad JSON) without crashing", () => {
    const t = join(dir, "t.jsonl");
    const c = join(dir, "cards.jsonl");
    writeFileSync(
      t,
      "{not json\n" + transcriptWith("VERDICT: APPROVED score 9.5 card-id: cc-88 channel: landing_page"),
    );
    const result = reconcile(t, c);
    expect(result.created).toContain("cc-88");
  });

  it("tolerates an empty transcript file", () => {
    const t = join(dir, "t.jsonl");
    writeFileSync(t, "");
    expect(reconcile(t, join(dir, "cards.jsonl")).created).toEqual([]);
  });
});

describe("findVerdictsWithoutCards", () => {
  it("returns verdict ids present in the transcript but absent from cards", () => {
    const text = "VERDICT: APPROVED score 9.5 card-id: cc-5 channel: landing_page";
    expect(findVerdictsWithoutCards(text, [])).toEqual(["cc-5"]);
  });

  it("excludes verdict ids that already have a card", () => {
    const text = "VERDICT: APPROVED score 9.5 card-id: cc-5 channel: landing_page";
    const existing = [
      parseCard({ id: "cc-5", channel: "landing_page", topic: "t", status: "approved", created: "2026-07-23" }),
    ];
    expect(findVerdictsWithoutCards(text, existing)).toEqual([]);
  });

  it("dedupes repeated ids within the same transcript", () => {
    const text =
      "VERDICT: REJECTED score 6 card-id: cc-9 channel: email\n" +
      "VERDICT: APPROVED score 9 card-id: cc-9 channel: email";
    expect(findVerdictsWithoutCards(text, [])).toEqual(["cc-9"]);
  });

  it("returns an empty array for text with no verdict block", () => {
    expect(findVerdictsWithoutCards("nothing to see here", [])).toEqual([]);
  });
});
