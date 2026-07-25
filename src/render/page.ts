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
  // Intentionally unreferenced in renderPage's output: the slug is consumed
  // by the caller/router (Task 16) to choose the artifact's URL path, not by
  // the page body itself. Not a bug -- see task-12's brief.
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
 * Schemes a CTA `href` is allowed to resolve to. Everything else --
 * `javascript:`, `data:`, `vbscript:`, `file:`, and any other scheme -- is a
 * code-execution or local-resource-access vector when placed in an anchor's
 * `href` and must never reach rendered output.
 */
const ALLOWED_HREF_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * Inert fallback used in place of a CTA href whose scheme was rejected.
 * Never navigates anywhere, so a rejected link fails safe rather than
 * quietly doing nothing under a live-looking button. Rejections are also
 * logged (see `buildTrackedUrl`) so the failure is visible to the operator,
 * not just to whoever inspects the rendered markup.
 */
export const REJECTED_HREF = "#";

/**
 * Attribute name written onto the CTA anchor whenever its href was rejected
 * -- for a disallowed (or obfuscated) scheme, or because the href was empty
 * or whitespace-only -- alongside the `href="${REJECTED_HREF}"` fallback.
 * This is what makes a rejection visible in the artifact itself rather than
 * only on stderr: a rendered page with a dead CTA is otherwise byte-for-byte
 * indistinguishable from a healthy one to anything that only reads the
 * markup (design-lint, the brand guardian, a human skimming the page).
 * Exported so Task 14's Playwright verification -- and this file's own
 * tests -- can assert on it by name instead of a duplicated string literal.
 */
export const CTA_REJECTED_ATTR = "data-cta-rejected";

/**
 * Reports whether `value` would resolve to an http/https navigation if a
 * real browser followed it from an http(s) page. Resolving against a dummy
 * http base (rather than pattern-matching the raw string) is what makes this
 * immune to case, whitespace, and control-character evasions
 * (`JaVaScRiPt:`, `java\tscript:`, a leading newline): the WHATWG URL
 * algorithm strips ASCII tab/newline characters and leading/trailing C0
 * controls, and lowercases the scheme, before this function ever sees
 * `.protocol`. A value with no scheme of its own (a relative path, or a
 * protocol-relative `//host/path`) inherits the dummy base's `http:` and is
 * treated as safe; only a value that declares its own non-http(s) scheme is
 * rejected. Protocol-relative hrefs are a deliberate exception here: they
 * are a same-scheme host-redirect concern, not a script-execution one, and
 * rejecting them would also reject legitimate relative CTAs like `/pricing`
 * that fail `new URL()` without a base for the same structural reason.
 */
function resolvesToHttpScheme(value: string): boolean {
  try {
    return ALLOWED_HREF_PROTOCOLS.has(new URL(value, "http://sentinel.invalid/").protocol);
  } catch {
    return false;
  }
}

/** Decodes a numeric HTML character reference (`&#58;` / `&#x3a;`) to the literal
 * character it represents; every other byte is left untouched. Only numeric
 * references are handled (not named ones like `&amp;`) -- this keeps the
 * decode narrowly scoped to the one evasion shape it exists to reveal
 * (`javascript&#58;...`) rather than a general-purpose entity decoder that
 * could itself introduce surprises.
 */
function decodeNumericEntities(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code: string) => {
    const isHex = code[0]?.toLowerCase() === "x";
    const codepoint = isHex ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    // A reference can name a codepoint outside the valid Unicode range or a
    // lone surrogate half (e.g. a many-digit decimal reference, or one of
    // 0xD800-0xDFFF) -- String.fromCodePoint throws RangeError on either, and
    // a malformed operator input must degrade this decode pass, not crash
    // the whole render.
    const isValidCodepoint =
      Number.isFinite(codepoint) &&
      codepoint >= 0 &&
      codepoint <= 0x10ffff &&
      !(codepoint >= 0xd800 && codepoint <= 0xdfff);
    if (!isValidCodepoint) return match;
    try {
      return String.fromCodePoint(codepoint);
    } catch {
      return match;
    }
  });
}

/** Percent-decodes `value`; an invalid escape sequence is a data problem, not
 * a crash, so decode failure returns `value` unchanged rather than throwing.
 */
function decodePercentEncoding(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Strips a single leading byte-order mark (U+FEFF), if present. The WHATWG
 * URL algorithm's leading-character trim only removes C0 controls and space
 * (0x00-0x20); a BOM (0xFEFF) sits outside that range and survives, which is
 * exactly what lets it mask a scheme's first character from being read as an
 * ASCII alpha.
 */
function stripLeadingBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

/**
 * Reports whether decoding `value` one of three ways -- numeric HTML
 * entities, percent-encoding, or a leading BOM -- reveals a disallowed
 * scheme that the raw string's own (correctly relative) classification hid.
 * These are the three reviewer-found evasion shapes that currently produce a
 * dead/broken link with no signal: `javascript&#58;...` and
 * `%6a%61%76%61script:...` contain no literal, spec-valid scheme (so
 * `resolvesToHttpScheme` correctly calls them relative and safe), and a
 * leading BOM before `javascript:` breaks the scheme grammar's
 * "first character must be an ASCII alpha" rule the same way. None of these
 * are exploitable through this renderer -- `esc()` HTML-escapes the raw `&`
 * before it ever reaches the `href` attribute, so a browser never re-decodes
 * the numeric reference back into a working scheme, and the other two never
 * had a live scheme to begin with. This check exists purely so the artifact
 * records "this href was junk/an evasion attempt" instead of quietly
 * shipping a link that 404s.
 *
 * Only a single decode pass is applied to each candidate (no recursive/
 * nested decoding). That is a deliberate scope limit matched to the three
 * documented examples, not a claim of catching every possible obfuscation --
 * see the task-12 report for the reasoning.
 */
function revealsDisallowedSchemeWhenDecoded(value: string): boolean {
  const candidates = [decodeNumericEntities(value), decodePercentEncoding(value), stripLeadingBom(value)];
  return candidates.some((candidate) => candidate !== value && !resolvesToHttpScheme(candidate));
}

/** Why a CTA href was rejected: `"empty"` for a blank/whitespace-only href
 * (no destination was ever provided), `"scheme"` for a disallowed scheme --
 * whether spelled out directly (`javascript:`) or disguised through encoding
 * (see `revealsDisallowedSchemeWhenDecoded`). Both are dead-link outcomes
 * from the artifact's point of view, but they are different upstream
 * problems worth telling apart in the marker's value -- see `CTA_REJECTED_ATTR`.
 */
type CtaRejectionReason = "empty" | "scheme";

function classifyCtaHref(value: string): CtaRejectionReason | null {
  if (value.trim().length === 0) return "empty";
  if (!resolvesToHttpScheme(value)) return "scheme";
  if (revealsDisallowedSchemeWhenDecoded(value)) return "scheme";
  return null;
}

/**
 * The card id (and campaign) ride every outbound link, so attribution is a
 * property of the artifact itself rather than something bolted on later.
 *
 * Scheme (and blank-href) validation happens first, before any tracking
 * params are attached, so a rejected href is rejected outright rather than
 * shipped with UTM params glued onto a `javascript:` URI or an empty string.
 * `new URL(base)` throws on a malformed/non-absolute `ctaHref` that *did*
 * pass validation (a relative path, or a string that is not a URL at all)
 * -- and that is a data problem the renderer should degrade around, not
 * something that should take down an entire page render. When parsing
 * fails, the tracking params are appended to the raw string by hand instead
 * of via `URLSearchParams`, so the caller still gets a link (with tracking
 * attached) rather than an uncaught exception.
 */
export function buildTrackedUrl(base: string, spec: PageSpec): string {
  const rejection = classifyCtaHref(base);
  if (rejection !== null) {
    const reasonText =
      rejection === "empty"
        ? "an empty or whitespace-only href"
        : "a disallowed (or encoding-disguised) scheme";
    console.error(
      `[render/page] rejected CTA href (${reasonText}) for card "${spec.cardId}": ` +
        `${JSON.stringify(base)}. Only http: and https: are permitted; ` +
        `falling back to "${REJECTED_HREF}".`,
    );
    return REJECTED_HREF;
  }

  const params: ReadonlyArray<readonly [string, string]> = [
    ["utm_source", "landing_page"],
    ["utm_medium", "owned"],
    ["utm_campaign", spec.campaignId],
    ["utm_content", spec.cardId],
  ];
  try {
    const url = new URL(base);
    for (const [key, value] of params) url.searchParams.set(key, value);
    return url.toString();
  } catch {
    const separator = base.includes("?") ? "&" : "?";
    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${base}${separator}${query}`;
  }
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
 *
 * The rejected-CTA rule below (`.cta[${CTA_REJECTED_ATTR}]`) is the one rule
 * in this stylesheet that carries no colour at all, by design: a struck-
 * through label with a "not-allowed" cursor is the smallest honest signal
 * that a CTA is non-functional, and it needs no new colour (hardcoded or
 * token-derived) to read that way. `pointer-events:none` was deliberately
 * left out even though the CTA has nothing safe to navigate to: it would
 * stop a real click event from ever reaching the element, which is exactly
 * the interaction the existing browser test (and any future automated
 * check) needs to observe firing harmlessly against the safe fallback href
 * -- the visual signal should not remove the thing being tested. Nothing
 * here uses a CSS custom property either, for the same reason as every
 * other rule in this function.
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
  .cta[${CTA_REJECTED_ATTR}]{text-decoration:line-through;cursor:not-allowed}
  footer{margin-top:${s.lg};font-size:.8rem;color:${c.muted}}`;
}

/** Turns an approved PageSpec plus design tokens into a self-contained landing page document. */
export function renderPage(spec: PageSpec, tokens: DesignTokens): string {
  const trackedCta = buildTrackedUrl(spec.ctaHref, spec);
  // Defense in depth: re-validate the scheme immediately before writing it
  // into the `href` attribute, independent of buildTrackedUrl's own check.
  // buildTrackedUrl is the only caller of this function today, so this can
  // never fire in practice -- but it means renderPage stays safe on its own
  // terms even if a future refactor hands it a pre-built href that skipped
  // buildTrackedUrl entirely.
  const cta = resolvesToHttpScheme(trackedCta) ? trackedCta : REJECTED_HREF;
  // The marker is driven by the same rejection this href fell back for, not
  // merely by `cta === REJECTED_HREF` (a legitimate ctaHref could in
  // principle be the literal string "#"): re-classify spec.ctaHref
  // independently, mirroring the defense-in-depth check above. If the
  // defense-in-depth branch above ever does fire on a future refactor (a
  // pre-built href that bypassed buildTrackedUrl and reclassifies as `null`
  // here), default to "scheme" -- a rejection with no classified reason is
  // still a rejection, and this renderer fails toward visibility, not
  // toward a silently unmarked "#".
  const rejection: CtaRejectionReason | null =
    cta !== REJECTED_HREF ? null : (classifyCtaHref(spec.ctaHref) ?? "scheme");
  // aria-disabled deliberately not added here: Playwright (and some other
  // automation/assistive tooling) treats `aria-disabled="true"` as "not
  // enabled" for interaction purposes, which made the existing browser test
  // -- clicking the CTA to prove the click is harmless against the safe
  // fallback href -- hang waiting for an element it considered unclickable.
  // The marker attribute plus the visual strike-through/cursor signal below
  // are the chosen "smallest honest signal"; they describe the state
  // without removing the interaction other checks need to observe.
  const ctaRejectedAttrs = rejection !== null ? ` ${CTA_REJECTED_ATTR}="${rejection}"` : "";

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
  <a class="cta" href="${esc(cta)}" data-card-id="${esc(spec.cardId)}"${ctaRejectedAttrs}>${esc(spec.ctaLabel)}</a>
  <footer>${esc(MARKER_TEXT)}</footer>
</main>
<script>
  // The card id is never re-embedded into this script: it is read back from
  // the already-escaped data-card-id attribute on the CTA element instead.
  // Interpolating spec.cardId directly here (even via JSON.stringify) would
  // let a value containing the script element's closing tag terminate this
  // element early and let attacker-controlled markup after it execute as a
  // new script -- JSON.stringify escapes JS string syntax, not HTML tag
  // boundaries. (Deliberately not spelling that closing tag out literally in
  // this comment: the HTML tokenizer ends a script element on that byte
  // sequence even inside a JS comment, so writing it here would reproduce
  // the exact bug this code exists to close.) Reading the id out of the DOM
  // instead removes the injection surface entirely rather than trying to
  // out-escape the HTML tokenizer.
  var cta = document.querySelector(".cta");
  var cardId = cta.dataset.cardId;
  fetch("/api/visit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ card_id: cardId, kind: "view" }),
  }).catch(function () {});
  cta.addEventListener("click", function () {
    navigator.sendBeacon("/api/visit", JSON.stringify({
      card_id: cardId, kind: "click",
    }));
  });
</script>
</body>
</html>`;
}
