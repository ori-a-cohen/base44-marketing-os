import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { MARKER_TEXT, CTA_REJECTED_ATTR } from "../render/page.js";

export interface VerifyResult {
  readonly pass: boolean;
  readonly failures: readonly string[];
  /**
   * Present only when verification could not run at all -- most commonly
   * because no Chromium binary is installed on this machine -- as opposed to
   * running and finding the page bad. Deliberately a distinct, optional
   * field rather than folded into `failures`: a caller that only reads
   * `failures.join(" ")` for a human-readable list must never see "could not
   * launch a browser" presented as if it were a defect in the page itself.
   * `pass` is still `false` in this case (a page nobody could check is not
   * shippable), but a caller that cares about the distinction (Task 20's
   * build CLI, Task 21's cold-clone demo) can branch on `skippedReason` to
   * print "could not verify" instead of "FAIL".
   */
  readonly skippedReason?: string;
}

const MOBILE_WIDTH = 375;

/**
 * The path Playwright would launch for `chromium.launch()` on this machine,
 * regardless of whether the binary actually exists there yet. Exposed so the
 * missing-browser check below (and its test) can inspect the path without
 * duplicating Playwright's own resolution logic.
 */
export function resolveChromiumExecutablePath(): string {
  return chromium.executablePath();
}

/**
 * Reports whether the Chromium binary Playwright would launch is present on
 * disk. This is a synchronous, near-instant filesystem check performed
 * *before* ever attempting `chromium.launch()` -- a fresh clone with zero
 * `npx playwright install` runs is the normal, expected state this project's
 * cold-run constraint anticipates (see CONTRIBUTING.md's non-negotiable
 * invariants and this task's brief), not an exceptional one, so the check is
 * a plain boolean predicate rather than something wrapped in try/catch.
 *
 * `execPath` defaults to the real resolved path but accepts an override so
 * tests can exercise both branches (installed / not installed) without
 * depending on this machine's actual browser state -- see
 * tests/verify/page-browser-missing.test.ts, which asserts this predicate's
 * behaviour directly with a path guaranteed not to exist.
 */
export function isChromiumInstalled(execPath: string = resolveChromiumExecutablePath()): boolean {
  return existsSync(execPath);
}

const BROWSER_MISSING_MESSAGE =
  'Could not verify: no Chromium binary installed. Run "npx playwright install chromium" and retry.';

function launchFailureMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Could not verify: failed to launch Chromium (${detail}). Run "npx playwright install chromium" and retry.`;
}

/**
 * The deterministic half of "is this page right". Runs before any model call,
 * so the design guardian only ever looks at pages that already passed for
 * free (see CLAUDE.md's content flow and this task's brief).
 *
 * Font-loaded verification is intentionally NOT implemented here. DESIGN.md's
 * typography rule ("verify fonts actually LOADED ... if [rendering with and
 * without the font] match, you silently fell back") is satisfied for the
 * satori/social-card path by src/render/card-image.ts, which embeds real TTF
 * bytes and can meaningfully compare rasterized output. src/render/page.ts
 * (the HTML this function verifies) does the opposite: it writes bare
 * `font-family:"Dazzed",...` / `font-family:"Geist",...` declarations with no
 * `@font-face` rule and no embedded font resource at all. That means there is
 * nothing in the rendered DOM for a browser to have actually "loaded" --
 * whether `document.fonts.check()` reports a match depends entirely on
 * whether a font of that exact name happens to be installed on the OS
 * running the check, which is precisely the environment-dependent,
 * non-deterministic signal this project's testing conventions rule out (see
 * this task's "keep them deterministic" instruction), and it would also make
 * the very first test above -- "passes a correctly rendered page" -- fail on
 * every machine, since no page this renderer produces ever actually embeds a
 * font file. Asserting a check that would always fail (dishonest in the
 * other direction) is exactly as wrong as asserting one that always passes.
 * Once (if) src/render/page.ts embeds fonts via `@font-face` the way
 * card-image.ts already does, this function should assert on
 * `document.fonts.status` for the specific face -- that would be a real,
 * deterministic signal. Until then, this is a known, stated gap rather than
 * a silently-passing check.
 */
export async function verifyPageHtml(html: string): Promise<VerifyResult> {
  if (!isChromiumInstalled()) {
    return { pass: false, failures: [], skippedReason: BROWSER_MISSING_MESSAGE };
  }

  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    return { pass: false, failures: [], skippedReason: launchFailureMessage(err) };
  }

  const failures: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: MOBILE_WIDTH, height: 800 } });
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const h1Count = await page.locator("h1").count();
    if (h1Count !== 1) failures.push(`Expected exactly one h1, found ${h1Count}.`);

    const ctaCount = await page.locator("a.cta").count();
    if (ctaCount !== 1) failures.push(`Expected exactly one primary CTA, found ${ctaCount}.`);

    if (ctaCount === 1) {
      const cta = page.locator("a.cta");
      const href = (await cta.getAttribute("href")) ?? "";
      if (!href.includes("utm_content=")) failures.push("CTA href is missing utm_content tracking.");
      if (!href.includes("utm_campaign=")) failures.push("CTA href is missing utm_campaign tracking.");

      // Task 12's report flagged this explicitly: renderPage sets
      // CTA_REJECTED_ATTR on the CTA anchor when its href was rejected
      // (non-http scheme, or empty/whitespace-only) and falls back to an
      // inert "#" href. A page in that state ships a dead button -- exactly
      // the kind of objectively-checkable defect this verification step
      // exists to catch before any human or model looks at the page.
      const rejectedReason = await cta.getAttribute(CTA_REJECTED_ATTR);
      if (rejectedReason !== null) {
        failures.push(
          `CTA href was rejected (${CTA_REJECTED_ATTR}="${rejectedReason}"): the button is a dead link.`,
        );
      }
    }

    // Read via page.evaluate rather than
    // `page.locator('meta[name="x-card-id"]').getAttribute("content")`: a
    // Locator's getAttribute auto-waits on the default 30s actionability
    // timeout when zero elements match, which is exactly the state a page
    // missing this tag is in -- the check this line exists to catch would
    // hang for 30s and then reject instead of reporting a failure. evaluate
    // runs a plain DOM query with no actionability wait, so a missing tag
    // resolves to `null` immediately and falls into the ordinary failures
    // path below.
    const cardId = await page.evaluate(
      () => document.querySelector('meta[name="x-card-id"]')?.getAttribute("content") ?? null,
    );
    if (!cardId) failures.push("Page is missing the x-card-id meta tag.");

    const bodyText = await page.locator("body").innerText();
    if (!bodyText.includes(MARKER_TEXT)) {
      failures.push("Page is missing the required not-official marker text.");
    }

    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    if (scrollW > MOBILE_WIDTH + 1) {
      failures.push(`Horizontal overflow at ${MOBILE_WIDTH}px: scrollWidth is ${scrollW}.`);
    }
  } catch (err) {
    // Any unexpected Playwright rejection (a page crash, a navigation error,
    // a future check that reintroduces the auto-wait hazard above) must
    // become a controlled outcome, never an uncaught rejection -- that is
    // this whole function's honesty property. Reported as an ordinary
    // `failures` entry (pass:false) rather than `skippedReason`:
    // `skippedReason` is reserved for "verification could not even start"
    // (no Chromium binary, launch failure) -- infrastructure problems
    // orthogonal to the page under test. This branch runs only after a
    // browser launched and a page was already open, so whatever failed did
    // so while actually looking at this page's content; treating that as a
    // fail (exit 2, blocks shipping) rather than a skip (exit 3) is the
    // safer default -- a page that broke the verifier gets treated as
    // unshippable, not waved through as "infra issue, retry later".
    const detail = err instanceof Error ? err.message : String(err);
    failures.push(`verification error: ${detail}`);
  } finally {
    // browser.close() can itself reject (e.g. the browser process already
    // crashed) -- a real Playwright failure mode. Letting that propagate
    // would turn an already-computed result into an uncaught rejection,
    // reproducing the exact bug this function's try/catch above exists to
    // eliminate. A close failure is a real cost (a leaked/broken browser
    // process), so it is surfaced to stderr rather than swallowed silently,
    // but it must never discard the verdict already computed in `failures`.
    try {
      await browser.close();
    } catch (closeErr) {
      const detail = closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.error(`verifyPageHtml: browser.close() failed: ${detail}`);
    }
  }
  return { pass: failures.length === 0, failures };
}
