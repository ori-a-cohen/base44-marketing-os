import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTokens } from "../../src/lint/tokens.js";

/**
 * Static assertions over the board's single HTML file.
 *
 * Why this file exists at all: hooks/design-lint.sh scopes itself to
 * build/pages/* (and hooks/brand-lint.sh to content/*), so src/board/ui.html
 * -- the one hand-written surface that represents the brand -- is exempt from
 * every automated gate in the repo. These tests are that gate. They are pure
 * string checks against the file on disk, so they cost milliseconds and need
 * no browser; behaviour lives in ui.browser.test.ts.
 *
 * Paths resolve through fileURLToPath, never URL.pathname: this repo's root
 * contains a space ("Base44 MarketingOS"), which .pathname leaves as %20 and
 * every readFileSync against it then silently fails.
 */
const UI_PATH = fileURLToPath(new URL("../../src/board/ui.html", import.meta.url));
const DESIGN_PATH = fileURLToPath(new URL("../../brand/DESIGN.md", import.meta.url));

const ui = readFileSync(UI_PATH, "utf8");

/** Every data-testid the browser test drives. Kept here so a rename in the
 * markup fails in milliseconds rather than inside a Playwright run -- and so
 * the attributes cannot rot into decoration again, which is what they were
 * before this suite existed (nothing referenced them). */
export const BOARD_TESTIDS = [
  "metric",
  "malformed",
  "campaigns",
  "campaign-row",
  "per-surface",
  "rule-accountability",
  "cohort-audience",
  "cohort-campaign",
  "stub-surfaces",
  "font-fallback",
] as const;

describe("board UI: document shape", () => {
  it("declares a doctype so it renders in standards mode", () => {
    expect(ui.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("declares a document language", () => {
    expect(ui).toMatch(/<html lang="en">/);
  });

  it("stays inside CONTRIBUTING's 800-line hard maximum", () => {
    expect(ui.split("\n").length).toBeLessThan(800);
  });

  it("exposes every data-testid the browser test drives", () => {
    for (const id of BOARD_TESTIDS) {
      expect(ui, `missing data-testid="${id}"`).toContain(`data-testid="${id}"`);
    }
  });
});

describe("board UI: the one deployment seam", () => {
  /**
   * The same file is the board in both places: served by src/board/server.ts
   * locally, and deployed to Base44 hosting by src/board/build-site.ts. The
   * ONLY thing that differs between the two is where the BoardView comes
   * from, so that difference is confined to a single declared value rather
   * than a forked copy of the file. Two boards is how the last drift
   * happened; one board with one seam is the fix.
   */
  it("declares its data source as a meta tag, defaulting to the local server", () => {
    expect(ui).toMatch(/<meta name="board-endpoint" content="\/api\/board">/);
  });

  it("reads the endpoint from that tag rather than hardcoding a path in the fetch", () => {
    expect(ui).toContain('meta[name="board-endpoint"]');
    // Exactly one fetch of board data, and it goes through the declared
    // endpoint -- a second hardcoded path would silently re-fork the file.
    expect(ui.match(/fetch\(/g) ?? []).toHaveLength(1);
    expect(ui).not.toMatch(/fetch\(\s*["']\/api\/board["']/);
  });
});

describe("board UI: design canon", () => {
  const tokens = parseTokens(readFileSync(DESIGN_PATH, "utf8"));

  /**
   * Uses the real parser against the real canon rather than a hardcoded list,
   * so changing a token in brand/DESIGN.md moves this assertion with it. A
   * near-miss hex (#FF6B00 for #FF6A00) is a violation, not a rounding error.
   */
  it("uses only colours that resolve to a token in brand/DESIGN.md", () => {
    const allowed = new Set(Object.values(tokens.colors).map((c) => c.toUpperCase()));
    const used = new Set((ui.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).map((c) => c.toUpperCase()));
    expect([...used].filter((c) => !allowed.has(c))).toEqual([]);
    expect(used.size).toBeGreaterThan(0);
  });

  /**
   * Deliberate, not incidental: findOffTokenValues only inspects the value
   * position of a named colour property, so a custom property declaration
   * (--ink:#1E1E24) is invisible to it. src/render/page.ts carries the long
   * form of this rationale; the board follows the same discipline so both
   * surfaces stay lintable by the same detector.
   */
  it("declares no CSS custom properties", () => {
    expect(ui).not.toMatch(/--[a-z][a-z0-9-]*\s*:/i);
  });

  it("has no elevation and no gradients", () => {
    expect(ui).not.toMatch(/box-shadow/i);
    expect(ui).not.toMatch(/(linear|radial|conic)-gradient/i);
  });

  it("carries no emoji (CONTRIBUTING rule 5)", () => {
    expect(ui).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("board UI: preview cannot fabricate a visit", () => {
  /**
   * The highest-stakes invariant in this file. Every generated page POSTs
   * /api/visit on load (src/render/page.ts), and that feeds outcome.value and
   * therefore the headline metric. An iframe of a card's own page is
   * same-origin, so without a sandbox the board would manufacture the very
   * number it exists to report honestly.
   *
   * sandbox="" -- the empty value, which enables every restriction -- turns
   * scripts off entirely, so the page still renders but the beacon cannot
   * run. Adding a single allow-scripts token silently re-opens the hole,
   * which is why it is asserted separately here and again end-to-end in
   * ui.browser.test.ts against the visits log itself.
   */
  it("sandboxes the preview iframe", () => {
    expect(ui).toMatch(/<iframe[^>]*\ssandbox=""/);
  });

  it("has no un-sandboxed iframe anywhere", () => {
    for (const tag of ui.match(/<iframe[^>]*>/g) ?? []) {
      expect(tag, `un-sandboxed iframe: ${tag}`).toMatch(/\ssandbox=""/);
    }
  });

  /**
   * The sandbox attribute must stay EMPTY. Any token in it re-enables the
   * matching capability, and allow-scripts specifically would let the framed
   * page's beacon run. Asserting the attribute is empty is stricter than
   * grepping for one token name, and it does not fire on the comments in
   * ui.html that explain why the token must never be added.
   */
  it("never loosens the sandbox with a token", () => {
    expect(ui).not.toMatch(/sandbox="[^"]+"/);
    expect(ui).not.toMatch(/sandbox\s*=\s*[^"]/);
  });

  it("never assembles a sandbox value at runtime", () => {
    expect(ui).not.toMatch(/setAttribute\(\s*["']sandbox/);
    expect(ui).not.toMatch(/\.sandbox\s*=/);
  });
});

describe("board UI: honesty seams", () => {
  /**
   * A value of 0 is a measurement; null is not. The board must never print a
   * bare 0 for "no data", so the em-dash and the explicit gated phrases have
   * to be present in the source. Behaviour is asserted in the browser test;
   * this just stops the vocabulary being deleted.
   */
  it("keeps the no-data vocabulary", () => {
    expect(ui).toContain("available, not configured");
    expect(ui).toContain("not a measured surface");
    expect(ui).toContain("—");
  });

  it("keeps the font-fallback notice", () => {
    expect(ui).toContain("Dazzed is licensed and not");
  });
});
