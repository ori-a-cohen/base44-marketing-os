import { describe, it, expect } from "vitest";
import { parseCard, CARD_STATES } from "../../src/cards/schema.js";

describe("parseCard", () => {
  it("accepts a minimal valid card", () => {
    const card = parseCard({
      id: "cc-100",
      channel: "landing_page",
      topic: "Base1 launch",
      status: "drafted",
      created: "2026-07-23",
    });
    expect(card.id).toBe("cc-100");
    expect(card.version).toBe(1);
    expect(card.verdicts).toEqual([]);
    expect(card.outcome).toBeNull();
  });

  it("rejects an unknown status", () => {
    expect(() =>
      parseCard({ id: "cc-1", channel: "x", topic: "t", status: "wat", created: "2026-07-23" }),
    ).toThrow(/status/);
  });

  it("rejects a card with no id", () => {
    expect(() =>
      parseCard({ channel: "x", topic: "t", status: "drafted", created: "2026-07-23" }),
    ).toThrow(/id/);
  });

  it("preserves the starter's existing fields", () => {
    const card = parseCard({
      id: "cc-001",
      channel: "linkedin",
      topic: "feature launch post",
      status: "shipped",
      guardian_score: 9.5,
      created: "2026-07-01",
      evidence: "https://example.com/post",
      history: ["drafted", "approved 9.5"],
    });
    expect(card.guardian_score).toBe(9.5);
    expect(card.evidence).toBe("https://example.com/post");
    expect(card.history).toHaveLength(2);
  });

  it("exposes the four lifecycle states in order", () => {
    expect(CARD_STATES).toEqual(["drafted", "approved", "shipped", "measured"]);
  });
});
