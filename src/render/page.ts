import type { DesignTokens } from "../lint/tokens.js";

/**
 * Carried verbatim, character for character (including the em dash), in
 * both the visible body and the page metadata. A page missing this string
 * fails verification (Task 14) and cannot ship -- see CLAUDE.md's iron laws
 * and this task's brief.
 */
export const MARKER_TEXT =
  "Demo — built by Ori Cohen for the Base44 take-home. Not official Base44 content.";

export interface PageSpec {
  readonly cardId: string;
  readonly slug: string;
  readonly headline: string;
  readonly subhead: string;
  readonly body: string;
  readonly ctaLabel: string;
  readonly ctaHref: string;
  readonly audienceId: string;
  readonly campaignId: string;
}

/** Escapes untrusted copy before it is interpolated into HTML text or attribute values. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The card id (and campaign) ride every outbound link, so attribution is a
 * property of the artifact itself rather than something bolted on later.
 */
export function buildTrackedUrl(base: string, spec: PageSpec): string {
  const url = new URL(base);
  url.searchParams.set("utm_source", "landing_page");
  url.searchParams.set("utm_medium", "owned");
  url.searchParams.set("utm_campaign", spec.campaignId);
  url.searchParams.set("utm_content", spec.cardId);
  return url.toString();
}

/**
 * Colour declarations below are written directly (`background:${c.x}`,
 * `color:${c.x}`, ...) rather than through CSS custom properties
 * (`--accent: #hex`). The design-lint detector (src/lint/tokens.ts) only
 * recognises colour values sitting in the value position of a named colour
 * property -- background, color, border, outline, fill, stroke, box-shadow.
 * A custom-property declaration such as `--bg:${c.background}` sits outside
 * every one of those property names, so it would never be checked against
 * the token allow-list at all -- a hole in the gate this renderer exists to
 * demonstrate, not exploit. Every colour here therefore lands in a property
 * name the linter actually inspects.
 */
function buildStyleSheet(tokens: DesignTokens): string {
  const c = tokens.colors;
  const s = tokens.spacing;
  const t = tokens.typography;

  return `
  *{box-sizing:border-box}
  body{margin:0;background:${c.background};color:${c.ink};
    font-family:"${t.body}",${t.fallback};line-height:1.6;padding:${s.lg} ${s.md}}
  main{max-width:44rem;margin:0 auto}
  .marker{font-size:.75rem;color:${c.muted};border:1px solid ${c.muted};
    border-radius:8px;padding:${s.sm} ${s.md};margin-bottom:${s.lg}}
  h1{font-family:"${t.display}",${t.fallback};color:${c.ink};font-size:2.5rem;
    line-height:1.1;margin:0 0 ${s.md}}
  .sub{font-size:1.15rem;color:${c.muted};margin:0 0 ${s.lg}}
  p{margin:0 0 ${s.md};color:${c.ink}}
  .cta{display:inline-block;background:${c.primary};color:${c.background};
    text-decoration:none;border-radius:8px;padding:${s.sm} ${s.md};
    font-weight:600;margin-top:${s.md}}
  .cta:focus-visible{outline:3px solid ${c.ink};outline-offset:2px}
  footer{margin-top:${s.lg};font-size:.8rem;color:${c.muted}}`;
}

/** Turns an approved PageSpec plus design tokens into a self-contained landing page document. */
export function renderPage(spec: PageSpec, tokens: DesignTokens): string {
  const cta = buildTrackedUrl(spec.ctaHref, spec);
  const cardId = JSON.stringify(spec.cardId);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.headline)} — Demo, not official Base44 content</title>
<meta name="description" content="${esc(spec.subhead)} Demo build. Not official Base44 content.">
<meta name="x-card-id" content="${esc(spec.cardId)}">
<meta name="x-audience-id" content="${esc(spec.audienceId)}">
<meta name="x-campaign-id" content="${esc(spec.campaignId)}">
<style>${buildStyleSheet(tokens)}
</style>
</head>
<body>
<main>
  <p class="marker">${esc(MARKER_TEXT)}</p>
  <h1>${esc(spec.headline)}</h1>
  <p class="sub">${esc(spec.subhead)}</p>
  <p>${esc(spec.body)}</p>
  <a class="cta" href="${esc(cta)}" data-card-id="${esc(spec.cardId)}">${esc(spec.ctaLabel)}</a>
  <footer>${esc(MARKER_TEXT)}</footer>
</main>
<script>
  fetch("/api/visit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ card_id: ${cardId}, kind: "view" }),
  }).catch(function () {});
  document.querySelector(".cta").addEventListener("click", function () {
    navigator.sendBeacon("/api/visit", JSON.stringify({
      card_id: ${cardId}, kind: "click",
    }));
  });
</script>
</body>
</html>`;
}
