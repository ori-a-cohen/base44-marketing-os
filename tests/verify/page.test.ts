import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTokens } from "../../src/lint/tokens.js";
import { renderPage, MARKER_TEXT, type PageSpec } from "../../src/render/page.js";
import { verifyPageHtml } from "../../src/verify/page.js";

const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));
const spec: PageSpec = {
  cardId: "cc-100", slug: "base1", headline: "Base1 builds your app",
  subhead: "First in-house model.", body: "Trained on real building patterns.",
  ctaLabel: "Start building", ctaHref: "https://base44.com",
  audienceId: "solo-builder", campaignId: "base1-launch",
};

describe("verifyPageHtml", () => {
  it("passes a correctly rendered page", async () => {
    const r = await verifyPageHtml(renderPage(spec, tokens));
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
  }, 30_000);

  it("fails a page missing the not-official marker", async () => {
    const stripped = renderPage(spec, tokens).replaceAll(MARKER_TEXT, "");
    const r = await verifyPageHtml(stripped);
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/marker/i);
  }, 30_000);

  it("fails a page with two h1 elements", async () => {
    const doubled = renderPage(spec, tokens).replace("</main>", "<h1>Second</h1></main>");
    const r = await verifyPageHtml(doubled);
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/h1/i);
  }, 30_000);

  it("fails a page whose CTA lost its tracking", async () => {
    const untracked = renderPage(spec, tokens).replace(/utm_content=cc-100/g, "");
    const r = await verifyPageHtml(untracked);
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/utm_content/i);
  }, 30_000);

  // Added beyond the brief: Task 12's report flagged that a CTA whose href
  // was rejected (non-http scheme, or empty) sets CTA_REJECTED_ATTR on the
  // anchor -- a page shipping a dead button, which is exactly the kind of
  // objectively-checkable defect this step exists to catch. CLAUDE.md and
  // this task's brief both call this out explicitly.
  it("fails a page whose CTA href was rejected (dead button)", async () => {
    const rejectedSpec: PageSpec = { ...spec, ctaHref: "javascript:alert(1)" };
    const r = await verifyPageHtml(renderPage(rejectedSpec, tokens));
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/cta-rejected|rejected/i);
  }, 30_000);
});
