import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTokens, findOffTokenValues } from "../../src/lint/tokens.js";

const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));

describe("parseTokens", () => {
  it("reads the real colours from DESIGN.md front matter", () => {
    expect(tokens.colors.background).toBe("#F9F7F4");
    expect(tokens.colors.ink).toBe("#1E1E24");
    expect(tokens.colors.primary).toBe("#FF6A00");
    expect(tokens.colors.muted).toBe("#6D6A67");
  });

  it("reads font names without the trailing comment", () => {
    expect(tokens.typography.display).toBe("Dazzed");
    expect(tokens.typography.body).toBe("Geist");
  });

  it("reads the spacing scale", () => {
    expect(tokens.spacing).toEqual({ sm: "8px", md: "16px", lg: "32px" });
  });
});

describe("parseTokens edge cases", () => {
  it("throws a clear error when there is no YAML front matter at all", () => {
    expect(() => parseTokens("# just a heading, no front matter\n")).toThrow(
      /no YAML front matter/,
    );
  });

  it("throws a clear error on malformed YAML inside the front matter", () => {
    const malformed = "---\ncolors: [unclosed\n---\nbody\n";
    expect(() => parseTokens(malformed)).toThrow();
  });

  it("degrades a missing token group to an empty object instead of crashing", () => {
    const noTypography = "---\ncolors:\n  primary: \"#FF6A00\"\n---\nbody\n";
    const result = parseTokens(noTypography);
    expect(result.typography).toEqual({});
    expect(result.colors).toEqual({ primary: "#FF6A00" });
  });

  it("ignores an unexpected extra top-level token group without crashing", () => {
    const withExtra = [
      "---",
      "colors:",
      '  primary: "#FF6A00"',
      "components:",
      "  cta-button:",
      '    rounded: "8px"',
      "---",
      "body",
      "",
    ].join("\n");
    const result = parseTokens(withExtra);
    expect(result.colors).toEqual({ primary: "#FF6A00" });
    expect(result).not.toHaveProperty("components");
  });

  it("throws a clear error distinguishing empty front matter from absent front matter", () => {
    expect(() => parseTokens("---\n---\n")).toThrow(/front matter is empty/);
  });
});

describe("findOffTokenValues", () => {
  it("accepts a token colour regardless of case", () => {
    expect(findOffTokenValues("color: #ff6a00;", tokens)).toEqual([]);
  });

  it("rejects a near-miss hex", () => {
    const f = findOffTokenValues("color: #FF6B00;", tokens);
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("#FF6B00");
  });

  it("rejects a second accent colour", () => {
    expect(findOffTokenValues("background: #00A3FF;", tokens)).toHaveLength(1);
  });

  it("rejects a gradient", () => {
    const f = findOffTokenValues("background: linear-gradient(#F9F7F4, #FF6A00);", tokens);
    expect(f.some((x) => x.message.toLowerCase().includes("gradient"))).toBe(true);
  });

  it("accepts white and black shorthand used for nothing visual", () => {
    expect(findOffTokenValues("no colours here at all", tokens)).toEqual([]);
  });
});

describe("findOffTokenValues — colour-context scoping (Fix 1)", () => {
  it("fires on an off-token hex in a colour property position", () => {
    expect(findOffTokenValues("color: #FF6B00;", tokens)).toHaveLength(1);
  });

  it("stays silent on the exact canon value in a colour property position", () => {
    expect(findOffTokenValues("background: #F9F7F4;", tokens)).toEqual([]);
  });

  it("fires on an off-token hex in a colour attribute position", () => {
    const f = findOffTokenValues('fill="#00A3FF"', tokens);
    expect(f).toHaveLength(1);
  });

  it("stays silent on a hex-shaped issue reference in prose", () => {
    expect(findOffTokenValues("See issue #123456 for details", tokens)).toEqual([]);
  });

  it("stays silent on a hex-shaped word in prose", () => {
    expect(findOffTokenValues("#decade", tokens)).toEqual([]);
  });

  it("stays silent on a hex-shaped value inside a non-colour attribute", () => {
    expect(findOffTokenValues('<h1 id="#FF6A00">', tokens)).toEqual([]);
  });

  it("recognises the canon hex regardless of case in a colour position", () => {
    expect(findOffTokenValues("color: #ff6a00;", tokens)).toEqual([]);
    expect(findOffTokenValues("color: #Ff6A00;", tokens)).toEqual([]);
  });

  it("fires on an off-token hex regardless of case in a colour position", () => {
    expect(findOffTokenValues("color: #ff6b00;", tokens)).toHaveLength(1);
  });
});

describe("findOffTokenValues — rgb()/hsl() detection (Fix 2)", () => {
  it("stays silent on rgb() expressing the canon primary exactly", () => {
    expect(findOffTokenValues("color: rgb(255, 106, 0);", tokens)).toEqual([]);
  });

  it("fires on an off-token rgb() value", () => {
    expect(findOffTokenValues("color: rgb(255, 107, 0);", tokens)).toHaveLength(1);
  });

  it("treats a translucent rgba() of the canon primary as off-token (documented policy)", () => {
    const f = findOffTokenValues("color: rgba(255, 106, 0, 0.5);", tokens);
    expect(f).toHaveLength(1);
    expect(f[0]?.message.toLowerCase()).toContain("translucent");
  });

  it("fires on hsl() and names the notation in the message", () => {
    const f = findOffTokenValues("color: hsl(24, 100%, 50%);", tokens);
    expect(f).toHaveLength(1);
    expect(f[0]?.message.toLowerCase()).toContain("hsl");
  });
});
