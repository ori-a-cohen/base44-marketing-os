import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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

  it("RULE 2: a vocabulary finding carries severity \"block\"", () => {
    const f = lintBrand("Leverage Base1 to build faster. Start now.", VOCAB);
    expect(f.find((x) => x.rule === 2)?.severity).toBe("block");
  });

  it("RULE 2: matches whole words only", () => {
    expect(lintBrand("The leveraged buyout closed. Start now.", VOCAB).some((x) => x.rule === 2)).toBe(false);
  });

  it("RULE 2: matches a term across a double space or a line wrap", () => {
    const doubleSpaceVocab = [{ never: "citizen developers", instead: "builders" }];
    expect(
      lintBrand("Built for citizen  developers everywhere. Start now.", doubleSpaceVocab).some(
        (x) => x.rule === 2,
      ),
    ).toBe(true);
    expect(
      lintBrand("Built for citizen\ndevelopers everywhere. Start now.", doubleSpaceVocab).some(
        (x) => x.rule === 2,
      ),
    ).toBe(true);
  });

  it("RULE 7: flags the fast-paced-world opener", () => {
    const f = lintBrand("In today's fast-paced world, shipping is hard. Start now.", VOCAB);
    expect(f.some((x) => x.rule === 7)).toBe(true);
  });

  it("RULE 7: flags the fast-paced-world opener with a curly apostrophe", () => {
    const f = lintBrand("In today’s fast-paced world, shipping is hard. Start now.", VOCAB);
    expect(f.some((x) => x.rule === 7)).toBe(true);
  });

  it("RULE 7: flags It's not X, it's Y contrast framing", () => {
    const f = lintBrand("It's not a tool, it's a teammate. Start now.", VOCAB);
    expect(f.some((x) => x.rule === 7)).toBe(true);
  });

  // Changed from the original expectation (no rule-7 finding at all) to
  // "no BLOCK finding": contrast framing is now "warn" severity, so a
  // plain factual clarification is allowed to surface as a warning for the
  // brand-guardian to judge intent on. It must never block the write on
  // its own, which this test pins down instead.
  it("RULE 7: does not produce a BLOCK finding for a plain factual 'it's not free, it's $20' sentence", () => {
    const f = lintBrand("It's not free, it's $20/month.", VOCAB);
    expect(f.some((x) => x.rule === 7 && x.severity === "block")).toBe(false);
  });

  it("RULE 7: 'It's not marketing, it's storytelling' produces a warn-severity finding (the genuine rhetorical tell)", () => {
    const f = lintBrand("It's not marketing, it's storytelling. Start building.", VOCAB);
    const rule7 = f.filter((x) => x.rule === 7);
    expect(rule7.some((x) => x.severity === "warn")).toBe(true);
    expect(rule7.some((x) => x.severity === "block")).toBe(false);
  });

  it("RULE 7: ordinary factual contrast-framing sentences never produce a BLOCK finding (warn is fine)", () => {
    const cases = [
      "It's not free, it's $20/month.",
      "It's not a discount, it's a fee.",
      "It's not a subscription, it's a one-time purchase.",
    ];
    for (const text of cases) {
      const f = lintBrand(text, VOCAB);
      expect(f.some((x) => x.rule === 7 && x.severity === "block")).toBe(false);
    }
  });

  it("RULE 7: reports every occurrence of a repeated AI tell, not just the first", () => {
    const f = lintBrand(
      "It's not a tool, it's a teammate. Later: it's not a chore, it's a delight.",
      VOCAB,
    );
    expect(f.filter((x) => x.rule === 7)).toHaveLength(2);
  });

  it("RULE 7: passes copy with no AI tells (targeted negative)", () => {
    const f = lintBrand("Build your first app today. It runs on real infrastructure. Start now.", VOCAB);
    expect(f.some((x) => x.rule === 7)).toBe(false);
  });

  it("RULE 8: flags Learn more as a CTA", () => {
    const f = lintBrand("Base1 builds apps. Learn more.", VOCAB);
    expect(f.some((x) => x.rule === 8)).toBe(true);
  });

  it("RULE 8: accepts an action verb CTA", () => {
    expect(lintBrand("Base1 builds apps. Start building now.", VOCAB).some((x) => x.rule === 8)).toBe(false);
  });

  it("RULE 8: does not flag 'more' as a substring of a longer word (word-boundary)", () => {
    expect(lintBrand("We spread more joy every day.", VOCAB).some((x) => x.rule === 8)).toBe(false);
  });

  it("RULE 8: still flags a genuine 'read more' CTA", () => {
    expect(lintBrand("Check out the results. Read more.", VOCAB).some((x) => x.rule === 8)).toBe(true);
  });

  it("RULE 8: matches a CTA across a double space or a line wrap", () => {
    expect(lintBrand("Curious? Learn  more.", VOCAB).some((x) => x.rule === 8)).toBe(true);
    expect(lintBrand("Curious? Learn\nmore.", VOCAB).some((x) => x.rule === 8)).toBe(true);
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

describe("parse-then-lint round trip against the real canon", () => {
  it("feeds copy with real canon-banned terms into lintBrand and gets rule-2 findings", () => {
    const md = readFileSync(new URL("../../brand/voice-guide.md", import.meta.url), "utf8");
    const vocab = parseVocabulary(md);
    const findings = lintBrand("Our users can deploy containers with low-code. Start now.", vocab);
    const rule2 = findings.filter((f) => f.rule === 2);
    expect(rule2.some((f) => /"users"/i.test(f.message))).toBe(true);
    expect(rule2.some((f) => /"low-code"/i.test(f.message))).toBe(true);
  });
});

describe("cli-brand subprocess", () => {
  // Resolved from this test file's own location (not process.cwd()) and
  // passed to spawnSync as a discrete array element rather than a shell
  // string, so a repo root path containing a space (as this one does)
  // never needs manual quoting or escaping.
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..");
  const cliPath = resolve(repoRoot, "src/lint/cli-brand.ts");

  // spawnSync (rather than execFileSync) is used because it always returns
  // captured stdio, including stderr on a clean exit 0 run. execFileSync
  // only surfaces stderr when the process throws (non-zero exit), which
  // would silently drop the warn-only case's stderr output (exit 0, but
  // still has warnings printed) that the tests below need to assert on.
  function runCli(input: string): { readonly status: number | null; readonly stderr: string } {
    const result = spawnSync("npx", ["tsx", cliPath], { input, cwd: repoRoot, encoding: "utf8" });
    return { status: result.status, stderr: result.stderr };
  }

  it("exits 2 and reports rule-2 findings for copy with canon-banned terms", () => {
    const result = runCli("Our users can deploy containers with low-code. Start now.\n");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("rule 2");
  }, 30_000);

  it("exits 0 for clean copy", () => {
    const result = runCli("Batteries included. Start building now.\n");
    expect(result.status).toBe(0);
  }, 30_000);

  it("exits 0 (with a visible warning) for copy containing only a rule-7 contrast-framing warning", () => {
    const result = runCli("It's not marketing, it's storytelling. Start building.\n");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("WARNED");
    expect(result.stderr).toContain("rule 7");
  }, 30_000);

  it("exits 2 for copy containing a banned vocabulary term, even alongside a warning", () => {
    const result = runCli("Our users can deploy containers with low-code. Start now.\n");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("BLOCKED");
    expect(result.stderr).toContain("rule 2");
  }, 30_000);
});
