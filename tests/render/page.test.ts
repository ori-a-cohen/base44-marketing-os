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

describe("renderPage script-context injection", () => {
  // Demonstrated exploit: JSON.stringify() escapes JS string syntax but not
  // "</script" -- the HTML tokenizer terminates a <script> element on that
  // raw byte sequence regardless of JS-string escaping, so this payload used
  // to let arbitrary injected markup execute as a second/third script.
  const breakout = "</script><script>window.__xss_proof=1+1</script><script>";

  function countScriptTags(html: string): number {
    return (html.match(/<script[\s>]/gi) ?? []).length;
  }

  // The legitimate closing `</script>` tag at the end of the real inline
  // script also matches the raw "</script" byte sequence, so the safety
  // property under test is "exactly one occurrence -- the real closing tag
  // -- not zero", not a bare `.not.toContain`.
  function countScriptCloseSequences(html: string): number {
    return (html.match(/<\/script/gi) ?? []).length;
  }

  it("cardId: breakout payload cannot terminate the inline script early", () => {
    const html = renderPage({ ...spec, cardId: breakout }, tokens);
    // Exactly one "</script" sequence in the whole document -- the real
    // closing tag of the one legitimate inline script -- proves the payload
    // did not inject a second closing/opening pair.
    expect(countScriptCloseSequences(html)).toBe(1);
    expect(countScriptTags(html)).toBe(1);
    // The payload still lands somewhere visible (the data attribute), just
    // HTML-escaped rather than raw.
    expect(html).toContain('data-card-id="&lt;/script&gt;');
  });

  it("cardId: the inline script reads the id from the DOM, not from re-embedded data", () => {
    const html = renderPage({ ...spec, cardId: breakout }, tokens);
    expect(html).toContain("cta.dataset.cardId");
    expect(html).not.toContain(breakout);
  });

  it("audienceId: breakout payload in the meta tag is escaped, not raw", () => {
    const html = renderPage({ ...spec, audienceId: breakout }, tokens);
    expect(countScriptCloseSequences(html)).toBe(1);
    expect(html).toContain('name="x-audience-id" content="&lt;/script&gt;');
    expect(countScriptTags(html)).toBe(1);
  });

  it("campaignId: breakout payload in the meta tag and CTA URL is escaped, not raw", () => {
    const html = renderPage({ ...spec, campaignId: breakout }, tokens);
    expect(countScriptCloseSequences(html)).toBe(1);
    expect(html).toContain('name="x-campaign-id" content="&lt;/script&gt;');
    expect(countScriptTags(html)).toBe(1);
  });

  it("subhead, body, ctaLabel: breakout payload cannot reach script context", () => {
    for (const field of ["subhead", "body", "ctaLabel"] as const) {
      const html = renderPage({ ...spec, [field]: breakout }, tokens);
      expect(countScriptCloseSequences(html), `field: ${field}`).toBe(1);
      expect(countScriptTags(html), `field: ${field}`).toBe(1);
    }
  });

  it("slug: never reaches the rendered output, so a breakout payload is inert", () => {
    const html = renderPage({ ...spec, slug: breakout }, tokens);
    expect(countScriptCloseSequences(html)).toBe(1);
    expect(countScriptTags(html)).toBe(1);
  });

  it("baseline: a non-malicious cardId still round-trips through the DOM read", () => {
    const html = renderPage(spec, tokens);
    expect(html).toContain('data-card-id="cc-100"');
    expect(countScriptTags(html)).toBe(1);
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

  it("degrades instead of throwing on a malformed/non-absolute ctaHref", () => {
    expect(() => buildTrackedUrl("not a url", spec)).not.toThrow();
    const result = buildTrackedUrl("not a url", spec);
    expect(result).toContain("not a url");
    expect(result).toContain("utm_source=landing_page");
    expect(result).toContain("utm_campaign=base1-launch");
    expect(result).toContain("utm_content=cc-100");
  });

  it("degrade path appends with & when the malformed base already has a query string", () => {
    const result = buildTrackedUrl("not a url?ref=x", spec);
    expect(result).toContain("ref=x");
    expect(result).toContain("&utm_source=landing_page");
  });
});
