import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { lintBrand, parseVocabulary } from "../../src/lint/brand.js";

const VOCAB = [{ never: "leverage", instead: "use" }, { never: "empower", instead: "let you" }];

describe("lintBrand", () => {
  it("passes clean copy", () => {
    expect(lintBrand("Build your first app today. Start building.", VOCAB)).toEqual([]);
  });

  it("RULE 2: flags a banned vocabulary word", () => {
    const f = lintBrand("Leverage Base1 to build faster. Start now.", VOCAB);
    expect(f.some((x) => x.rule === 2)).toBe(true);
    expect(f.find((x) => x.rule === 2)?.message).toContain("use");
  });

  it("RULE 2: matches whole words only", () => {
    expect(lintBrand("The leveraged buyout closed. Start now.", VOCAB).some((x) => x.rule === 2)).toBe(false);
  });

  it("RULE 7: flags the fast-paced-world opener", () => {
    const f = lintBrand("In today's fast-paced world, shipping is hard. Start now.", VOCAB);
    expect(f.some((x) => x.rule === 7)).toBe(true);
  });

  it("RULE 7: flags It's not X, it's Y contrast framing", () => {
    const f = lintBrand("It's not a tool, it's a teammate. Start now.", VOCAB);
    expect(f.some((x) => x.rule === 7)).toBe(true);
  });

  it("RULE 8: flags Learn more as a CTA", () => {
    const f = lintBrand("Base1 builds apps. Learn more.", VOCAB);
    expect(f.some((x) => x.rule === 8)).toBe(true);
  });

  it("RULE 8: accepts an action verb CTA", () => {
    expect(lintBrand("Base1 builds apps. Start building now.", VOCAB).some((x) => x.rule === 8)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(lintBrand("LEVERAGE this. Start now.", VOCAB).some((x) => x.rule === 2)).toBe(true);
  });

  it("RULE 2: matches a banned word directly adjacent to punctuation", () => {
    expect(lintBrand("Leverage, empower, and ship. Start now.", VOCAB).filter((x) => x.rule === 2)).toHaveLength(2);
  });

  it("returns no findings for empty input", () => {
    expect(lintBrand("", VOCAB)).toEqual([]);
  });

  it("returns no findings when given an empty vocabulary", () => {
    expect(lintBrand("Leverage this. Learn more.", []).some((x) => x.rule === 2)).toBe(false);
  });
});

describe("parseVocabulary", () => {
  it("extracts we-never-say pairs from a markdown table", () => {
    const md = [
      "| We say | We never say |",
      "|---|---|",
      "| use | leverage |",
      "| let you | empower |",
    ].join("\n");
    expect(parseVocabulary(md)).toEqual([
      { never: "leverage", instead: "use" },
      { never: "empower", instead: "let you" },
    ]);
  });

  it("returns an empty list when no table is present", () => {
    expect(parseVocabulary("# Voice guide\n\nJust prose.")).toEqual([]);
  });

  // The real brand/voice-guide.md table packs multiple synonyms into each cell,
  // separated by middle dots or commas, quoted, and sometimes annotated with a
  // trailing parenthetical. The brief's naive one-term-per-cell parser silently
  // treats a whole cell as a single banned phrase, which would never match real
  // copy. These cases pin down parsing of that actual structure.
  it("splits multiple never-say terms joined by a middle dot", () => {
    const md = ['| builders · vibe coding | "users" · "citizen developers" |'].join("\n");
    expect(parseVocabulary(md)).toEqual([
      { never: "users", instead: "builders / vibe coding" },
      { never: "citizen developers", instead: "builders / vibe coding" },
    ]);
  });

  it("splits multiple never-say terms joined by commas", () => {
    const md = ['| go live · ship · build | "deploy", "CI/CD", "boilerplate", "containers" |'].join("\n");
    const result = parseVocabulary(md);
    expect(result.map((s) => s.never)).toEqual(["deploy", "CI/CD", "boilerplate", "containers"]);
    expect(result.every((s) => s.instead === "go live / ship / build")).toBe(true);
  });

  it("strips a trailing parenthetical note from a never-say term", () => {
    const md = ['| plain claim with a number | "easy for beginners" (condescending) · competitor trash-talk |'].join(
      "\n",
    );
    expect(parseVocabulary(md)).toEqual([
      { never: "easy for beginners", instead: "plain claim with a number" },
      { never: "competitor trash-talk", instead: "plain claim with a number" },
    ]);
  });

  it("parses the real brand/voice-guide.md we-say/we-never-say table without throwing and finds known bans", () => {
    const md = readFileSync(new URL("../../brand/voice-guide.md", import.meta.url), "utf8");
    const swaps = parseVocabulary(md);
    const banned = swaps.map((s) => s.never);
    expect(banned).toContain("users");
    expect(banned).toContain("citizen developers");
    expect(banned).toContain("low-code");
    expect(banned).toContain("no-code");
    expect(banned).toContain("revolutionary");
    expect(banned).toContain("game-changing");
  });
});
