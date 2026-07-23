import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseAudiences } from "../../src/cards/audiences.js";

const audiences = parseAudiences(readFileSync("brand/audiences.md", "utf8"));

describe("brand/audiences.md", () => {
  it("defines the four demo segments", () => {
    expect(audiences.map((a) => a.id).sort()).toEqual(
      ["dev-accelerator", "ops-builder", "solo-builder", "student-learner"],
    );
  });

  it("every segment declares a success rung tied to the funnel", () => {
    const valid = ["signup", "activation", "paid"];
    for (const a of audiences) {
      expect(valid.some((r) => a.successRung.includes(r))).toBe(true);
    }
  });

  it("every segment says what it does NOT care about", () => {
    for (const a of audiences) expect(a.ignores.length).toBeGreaterThan(0);
  });
});

describe("data/source-base1.md", () => {
  const src = existsSync("data/source-base1.md") ? readFileSync("data/source-base1.md", "utf8") : "";

  it("exists", () => expect(src.length).toBeGreaterThan(0));

  it("carries a source URL on every claim line", () => {
    // Scoped to the "Verified claims" section: the "Explicitly NOT claimable"
    // section below it also uses "- " bullets, but by design those carry no
    // URL (they are the things that must never be claimed).
    const verifiedSection = src.split("## Explicitly NOT claimable")[0] ?? "";
    const claims = verifiedSection.split("\n").filter((l) => l.trim().startsWith("- "));
    expect(claims.length).toBeGreaterThan(3);
    for (const c of claims) expect(c).toMatch(/https?:\/\//);
  });
});
