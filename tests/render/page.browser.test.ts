import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { parseTokens } from "../../src/lint/tokens.js";
import { renderPage, type PageSpec } from "../../src/render/page.js";

/**
 * Real-browser confirmation of the script-injection fix. The string-level
 * tests in page.test.ts prove the byte sequence "</script" never appears
 * unescaped; this test proves the thing that actually matters -- that a
 * real HTML parser + JS engine does not execute anything extra when given
 * the same breakout payload. Kept to a single browser launch, shared across
 * both assertions, to avoid this being the test that makes the suite slow.
 */
describe("renderPage in a real browser", () => {
  const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));
  const spec: PageSpec = {
    cardId: "</script><script>window.__xss_proof=1+1</script><script>",
    slug: "base1",
    headline: "Base1 builds your app",
    subhead: "Base44's first in-house model.",
    body: "Trained on real building patterns.",
    ctaLabel: "Start building",
    ctaHref: "https://base44.com",
    audienceId: "solo-builder",
    campaignId: "base1-launch",
  };

  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  it("does not execute the injected script and renders exactly one <script> element", async () => {
    const html = renderPage(spec, tokens);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    const scriptCount = await page.evaluate(() => document.scripts.length);
    const xssProof = await page.evaluate(
      () => (window as unknown as { __xss_proof?: number }).__xss_proof,
    );
    const cardIdRead = await page.evaluate(
      () => (document.querySelector(".cta") as HTMLElement | null)?.dataset.cardId,
    );

    expect(scriptCount).toBe(1);
    expect(xssProof).toBeUndefined();
    expect(cardIdRead).toBe(spec.cardId);

    await page.close();
  }, 15_000);
});

/**
 * Real-browser confirmation of the CTA href scheme fix. The unit tests in
 * page.test.ts prove the string-level output; this proves the thing that
 * actually matters -- that clicking the rendered anchor in a real browser
 * never runs the injected payload, because the href it navigates to is the
 * inert fallback, not the `javascript:` URI. Deterministic: no navigation
 * actually leaves the page (the fallback is `#`), so there is nothing to
 * wait on beyond the click itself.
 */
describe("renderPage CTA href scheme rejection in a real browser", () => {
  const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));
  const spec: PageSpec = {
    cardId: "cc-100",
    slug: "base1",
    headline: "Base1 builds your app",
    subhead: "Base44's first in-house model.",
    body: "Trained on real building patterns.",
    ctaLabel: "Start building",
    ctaHref: "javascript:window.__xss_href_proof=99;//",
    audienceId: "solo-builder",
    campaignId: "base1-launch",
  };

  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  it("clicking the CTA does not execute the javascript: payload", async () => {
    const html = renderPage(spec, tokens);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    await page.click("a.cta");

    const xssHrefProof = await page.evaluate(
      () => (window as unknown as { __xss_href_proof?: number }).__xss_href_proof,
    );
    const href = await page.evaluate(
      () => (document.querySelector(".cta") as HTMLAnchorElement | null)?.getAttribute("href"),
    );

    expect(xssHrefProof).toBeUndefined();
    expect(href).toBe("#");

    await page.close();
  }, 15_000);
});
