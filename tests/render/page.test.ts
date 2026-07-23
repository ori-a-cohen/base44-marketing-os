import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTokens } from "../../src/lint/tokens.js";
import { renderPage, buildTrackedUrl, MARKER_TEXT, type PageSpec } from "../../src/render/page.js";
import { findOffTokenValues } from "../../src/lint/tokens.js";

const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));
const spec: PageSpec = {
  cardId: "cc-100", slug: "base1", headline: "Base1 builds your app",
  subhead: "Base44's first in-house model.", body: "Trained on real building patterns.",
  ctaLabel: "Start building", ctaHref: "https://base44.com", audienceId: "solo-builder",
  campaignId: "base1-launch",
};

describe("renderPage", () => {
  const html = renderPage(spec, tokens);

  it("includes the not-official marker in the visible body", () => {
    expect(html).toContain(MARKER_TEXT);
  });

  it("includes the marker in the title and meta description", () => {
    expect(/<title>[^<]*Demo[^<]*<\/title>/i.test(html)).toBe(true);
    expect(/<meta name="description"[^>]*Not official/i.test(html)).toBe(true);
  });

  it("embeds the card id as a meta tag", () => {
    expect(html).toContain('name="x-card-id" content="cc-100"');
  });

  it("has exactly one h1", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it("has exactly one primary CTA carrying tracking params", () => {
    const ctas = html.match(/class="cta"/g);
    expect(ctas).toHaveLength(1);
    expect(html).toContain("utm_content=cc-100");
    expect(html).toContain("utm_campaign=base1-launch");
  });

  it("uses only token colours", () => {
    expect(findOffTokenValues(html, tokens)).toEqual([]);
  });

  it("declares a mobile viewport", () => {
    expect(html).toContain('name="viewport"');
  });

  it("escapes copy so injected markup cannot break the page", () => {
    const evil = renderPage({ ...spec, headline: '<script>alert(1)</script>' }, tokens);
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&lt;script&gt;");
  });
});

describe("buildTrackedUrl", () => {
  it("carries surface, medium, campaign and card id", () => {
    const url = buildTrackedUrl("https://base44.com", spec);
    expect(url).toContain("utm_source=landing_page");
    expect(url).toContain("utm_campaign=base1-launch");
    expect(url).toContain("utm_content=cc-100");
  });

  it("preserves an existing query string", () => {
    expect(buildTrackedUrl("https://base44.com/?ref=x", spec)).toContain("ref=x");
  });
});
