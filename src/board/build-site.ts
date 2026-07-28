import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Card } from "../cards/schema.js";
import { dedupeToLatestVersion } from "../metric/loop-closure.js";
import { pageSpecFromCard } from "../render/cli-build.js";
import { renderPage } from "../render/page.js";
import { resolveWebFonts } from "../render/web-fonts.js";
import type { DesignTokens } from "../lint/tokens.js";

/**
 * Builds the static site Base44 hosting serves, out of the SAME
 * src/board/ui.html the local server serves.
 *
 * The point of this file is that there is only one board. Before it, the
 * hosted board was a separate React client consuming the same BoardView, and
 * the two drifted -- the hosted one kept rendering an older UI for as long as
 * nobody remembered to port a change across. A second implementation of a
 * view is a promise to keep two things in step by hand, and that promise gets
 * broken. So the deployable artifact is the board file itself, with exactly
 * one value rewritten: where the BoardView comes from.
 *
 * The generated landing pages ship alongside it, at the same /c/<id>/<slug>
 * routes the board links to. Two things make that correct:
 *
 *  - They are built from the SAME cards the deployed board will render, not
 *    from whatever happens to sit in a local store. The hosted card's slug
 *    was `base1-launch` while the local one's was `base1`, so building from
 *    local data produced a site whose every preview 404'd -- caught by
 *    rendering the built site against live data before deploying, which is
 *    why that check exists.
 *  - They are re-derived from each card's own copy attributes rather than
 *    copied off disk, so the page a reader previews always matches the card
 *    the board is showing them. Artifacts are derived, never hand-carried.
 */

/** Anything that cannot sit inside a double-quoted HTML attribute, or that
 *  would turn a same-origin path into an off-origin fetch we did not intend. */
const SAFE_ENDPOINT = /^\/[A-Za-z0-9/_-]*$/;

/**
 * Rewrites one declared capability on the board.
 *
 * Throws rather than returning the input unchanged when the tag is absent: a
 * silently un-rewritten build would deploy a board configured for the wrong
 * host, which then fails at runtime in front of a reader instead of here.
 */
export function setMeta(html: string, name: string, value: string): string {
  const tag = new RegExp(`<meta name="${name}" content="[^"]*">`);
  if (!tag.test(html)) {
    throw new Error(
      `the board UI has no <meta name="${name}"> tag to rewrite -- ` +
        "src/board/ui.html must declare it for this build to target a host",
    );
  }
  return html.replace(tag, `<meta name="${name}" content="${value}">`);
}

/** Where the deployed board fetches its BoardView from. */
export function setBoardEndpoint(html: string, endpoint: string): string {
  if (!SAFE_ENDPOINT.test(endpoint)) {
    throw new Error(
      `refusing to build a site with endpoint ${JSON.stringify(endpoint)}: ` +
        "it must be a root-relative path matching /[A-Za-z0-9/_-]*",
    );
  }
  return setMeta(html, "board-endpoint", endpoint);
}

export type PreviewSupport = "on" | "off";

/**
 * Whether this host lets the board frame a card's own page.
 *
 * Base44 hosting sends X-Frame-Options: DENY on every response, so a preview
 * iframe there is refused by the browser and renders as a broken-image box.
 * The board cannot find that out before trying, so the deployment states it
 * and the board shows the page link instead -- an honest "not available
 * here", never a broken frame.
 */
export function setBoardPreview(html: string, preview: PreviewSupport): string {
  return setMeta(html, "board-preview", preview);
}

export interface BuildSiteOptions {
  readonly uiPath: string;
  /** The cards the DEPLOYED board will render -- normally fetched from the
   *  same endpoint the built board points at, never a different store. */
  readonly cards: readonly Card[];
  readonly tokens: DesignTokens;
  readonly outDir: string;
  /** Where the deployed board fetches its BoardView from. */
  readonly endpoint: string;
  /** Whether this host permits framing a card's page. Defaults to "off":
   *  this function only ever builds for a remote host, and assuming a host
   *  allows framing is how you ship a board full of broken frames. */
  readonly preview?: PreviewSupport;
  /** Where to resolve the faces each built page embeds. Defaults to the
   *  repo's assets/fonts/. Injectable so a test can point at a fixture
   *  directory, and so a deploy that ran without scripts/fetch-fonts.sh
   *  produces pages that name the fallback rather than claiming a face
   *  they never carried. */
  readonly fontsDir?: string;
}

export interface SiteReport {
  readonly indexPath: string;
  /** Routes actually written, in the form the board links to. */
  readonly pages: readonly string[];
  /** Cards the board will link to but whose page could not be derived,
   *  with the reason. Reported, never papered over: each one is a preview
   *  that will 404 in front of a reader. */
  readonly unbuildable: readonly { readonly id: string; readonly reason: string }[];
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

export function buildSite(opts: BuildSiteOptions): SiteReport {
  const ui = setBoardPreview(
    setBoardEndpoint(readFileSync(opts.uiPath, "utf8"), opts.endpoint),
    opts.preview ?? "off",
  );

  // Cleared, not merged: a card removed from the store must not keep serving
  // its old page from a previous build. Hosting deploys whatever is here.
  rmSync(opts.outDir, { recursive: true, force: true });

  const indexPath = join(opts.outDir, "index.html");
  write(indexPath, ui);

  const pages: string[] = [];
  const unbuildable: { id: string; reason: string }[] = [];

  // Resolved once for the whole site, not per card: every page in one build
  // carries the same faces, and re-reading the same files per card would
  // make a large deploy quadratic in font bytes for no benefit.
  const webFonts = resolveWebFonts(opts.fontsDir);

  // Current versions only -- the same "which row is live" resolution the
  // board itself renders from, so a superseded version's slug never gets a
  // route the board does not link to.
  for (const card of dedupeToLatestVersion(opts.cards)) {
    const slug = card.artifacts.page_slug;
    if (typeof slug !== "string" || slug.length === 0) continue;

    // A slug that could escape the output directory when joined into a path.
    if (slug.includes("/") || slug.includes("\\") || slug.includes("..") || card.id.includes("/")) {
      unbuildable.push({ id: card.id, reason: `unsafe page_slug ${JSON.stringify(slug)}` });
      continue;
    }

    let html: string;
    try {
      html = renderPage(pageSpecFromCard(card), opts.tokens, webFonts);
    } catch (error: unknown) {
      unbuildable.push({ id: card.id, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    write(join(opts.outDir, "c", card.id, slug, "index.html"), html);
    pages.push(`/c/${card.id}/${slug}`);
  }

  return { indexPath, pages, unbuildable };
}
