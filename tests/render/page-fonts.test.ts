import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTokens } from "../../src/lint/tokens.js";
import { renderPage, type PageSpec } from "../../src/render/page.js";
import type { PageFonts } from "../../src/render/web-fonts.js";

const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));

// Read once and fail loudly rather than defaulting: a canon missing a
// typography token is a broken canon, and a test that quietly substituted ""
// would keep passing while asserting nothing.
const { display: DISPLAY, body: BODY, fallback: FALLBACK } = tokens.typography;
if (!DISPLAY || !BODY || !FALLBACK) {
  throw new Error("brand/DESIGN.md is missing a typography token needed by this test");
}

const spec: PageSpec = {
  cardId: "cc-100",
  slug: "base1",
  headline: "Your next full-stack app",
  subhead: "Base44's first in-house model.",
  body: "Trained on real building patterns.",
  ctaLabel: "Start building",
  ctaHref: "https://base44.com",
  audienceId: "dev-accelerator",
  campaignId: "base1-launch",
};

/** The h1's font-family declaration, whitespace-normalised. */
function h1Stack(html: string): string {
  const match = /h1\{font-family:([^;]+);/.exec(html.replace(/\s+/g, " "));
  return match?.[1] ?? "";
}

function bodyStack(html: string): string {
  const match = /body\{[^}]*font-family:([^;]+);/.exec(html.replace(/\s+/g, " "));
  return match?.[1] ?? "";
}

describe("renderPage typography roles (design-guardian finding, cc-004)", () => {
  it("puts the body face in the h1 stack after the display face, so a missing display face degrades to the brand body face and not to the visitor's OS", () => {
    const stack = h1Stack(renderPage(spec, tokens));
    expect(stack).toContain(`"${DISPLAY}"`);
    expect(stack).toContain(`"${BODY}"`);
    expect(stack.indexOf(DISPLAY)).toBeLessThan(stack.indexOf(BODY));
  });

  it("never lets the body face outrank the display face on the h1", () => {
    // The inverted-roles bug: body copy in Geist while the headline drops
    // straight to system-ui.
    const stack = h1Stack(renderPage(spec, tokens));
    expect(stack.startsWith(`"${DISPLAY}"`)).toBe(true);
  });

  it("ends both stacks with the token fallback", () => {
    const html = renderPage(spec, tokens);
    expect(h1Stack(html).trim().endsWith(FALLBACK)).toBe(true);
    expect(bodyStack(html).trim().endsWith(FALLBACK)).toBe(true);
  });
});

describe("renderPage font embedding", () => {
  const fonts: PageFonts = {
    display: { family: "Geist", weight: 700, base64: "ZGlzcGxheQ==" },
    body: { family: "Geist", weight: 400, base64: "Ym9keQ==" },
  };

  it("emits no @font-face when no fonts are passed", () => {
    expect(renderPage(spec, tokens)).not.toContain("@font-face");
  });

  it("emits an @font-face per resolved face with the bytes inline", () => {
    const html = renderPage(spec, tokens, fonts);
    expect(html).toContain("@font-face");
    expect(html).toContain("data:font/ttf;base64,ZGlzcGxheQ==");
    expect(html).toContain("data:font/ttf;base64,Ym9keQ==");
  });

  it("declares each face at the weight it was resolved at", () => {
    const html = renderPage(spec, tokens, fonts).replace(/\s+/g, " ");
    expect(html).toMatch(/@font-face\{font-family:"Geist";font-weight:700/);
    expect(html).toMatch(/@font-face\{font-family:"Geist";font-weight:400/);
  });

  it("uses the resolved family names in the stacks, not the token names, so a fallback is named honestly", () => {
    // Dazzed is unlicensed for redistribution and never present, so the
    // display face resolves to Geist. The page must say Geist, not claim a
    // Dazzed it never loaded.
    const html = renderPage(spec, tokens, fonts);
    expect(h1Stack(html).startsWith('"Geist"')).toBe(true);
    expect(h1Stack(html)).not.toContain("Dazzed");
  });

  it("falls back to the token family name for a face that was not resolved", () => {
    const html = renderPage(spec, tokens, { body: fonts.body });
    expect(h1Stack(html)).toContain(`"${DISPLAY}"`);
    expect(h1Stack(html)).toContain('"Geist"');
  });

  it("collapses the stack when the display face resolved to the body face", () => {
    // "Geist","Geist" is inert: an identical second entry can never match
    // when the first fails, and the two weights are selected by font-weight,
    // not by stack position. The honest record of the fallback lives in
    // attributes.display_font and the board's font note, not in a repeated
    // string a reader cannot tell apart from a renderer bug.
    expect(h1Stack(renderPage(spec, tokens, fonts))).toBe(`"Geist",${FALLBACK}`);
  });

  it("keeps both entries when the display face is genuinely different", () => {
    const distinct: PageFonts = {
      display: { family: "Dazzed", weight: 700, base64: "ZA==" },
      body: fonts.body,
    };
    expect(h1Stack(renderPage(spec, tokens, distinct))).toBe(`"Dazzed","Geist",${FALLBACK}`);
  });

  it("carries the font licence notice into the page when a face is embedded", () => {
    // OFL 1.1 permits redistribution ON THE CONDITION that the copyright
    // notice and licence travel with the copy. assets/fonts/OFL.txt
    // discharges that for the repo; it does not travel with a page that
    // inlines 250KB of the font software into a shipped artifact.
    const html = renderPage(spec, tokens, { ...fonts, notice: "Copyright 2024 The Geist Project Authors" });
    expect(html).toContain("Copyright 2024 The Geist Project Authors");
  });

  it("emits no licence comment when nothing was embedded", () => {
    expect(renderPage(spec, tokens)).not.toContain("Copyright");
  });

  it("neutralises a comment terminator in the notice so it cannot break out of the CSS comment", () => {
    const html = renderPage(spec, tokens, { ...fonts, notice: "evil */ body{background:red} /*" });
    expect(html).not.toContain("*/ body{background:red}");
  });

  it("keeps every colour on-token when fonts are embedded", async () => {
    const { findOffTokenValues } = await import("../../src/lint/tokens.js");
    expect(findOffTokenValues(renderPage(spec, tokens, fonts), tokens)).toEqual([]);
  });
});
