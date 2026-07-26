import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { buildSite } from "./build-site.js";
import { parseTokens } from "../lint/tokens.js";
import { parseCard, type Card } from "../cards/schema.js";
import { readCards } from "../cards/store.js";

/**
 * CLI wrapper around buildSite -- the same pure-function/entrypoint split as
 * src/lint/cli-brand.ts. Produces the directory Base44 hosting serves:
 *
 *   npm run build:site      # -> dist/
 *   npm run deploy:board    # build, then base44 site deploy
 *
 * The board it deploys is src/board/ui.html itself, not a second copy of it.
 */

/** The Base44 app's `board` function, which returns the same BoardView the
 *  local server serves at /api/board. */
const HOSTED_ENDPOINT = "/functions/board";
const HOSTED_ORIGIN = "https://roundtrip-board-ecceb49b.base44.app";

/**
 * The cards the DEPLOYED board will render.
 *
 * Deliberately the deploy target's own data, not the local store: the two
 * genuinely differ (the hosted card's slug was `base1-launch` while the
 * local one's was `base1`), and building pages from the wrong one produces a
 * site whose every preview 404s. Build against the host you are deploying to.
 *
 * BOARD_SOURCE overrides it -- point it at a local path to build offline, at
 * the cost of the routes matching that store instead of the host's.
 */
export async function resolveCards(source: string): Promise<readonly Card[]> {
  if (!/^https?:\/\//i.test(source)) return readCards(source);

  const res = await fetch(source);
  if (!res.ok) throw new Error(`${source} answered ${res.status} -- cannot build the site against it`);

  const view: unknown = await res.json();
  const cards = (view as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) throw new Error(`${source} returned no cards array`);
  return cards.map((c) => parseCard(c));
}

export async function main(): Promise<void> {
  const source = process.env.BOARD_SOURCE ?? `${HOSTED_ORIGIN}${HOSTED_ENDPOINT}`;
  const designPath = fileURLToPath(new URL("../../brand/DESIGN.md", import.meta.url));

  const report = buildSite({
    uiPath: fileURLToPath(new URL("./ui.html", import.meta.url)),
    cards: await resolveCards(source),
    tokens: parseTokens(readFileSync(designPath, "utf8")),
    outDir: process.env.SITE_DIR ?? "dist",
    endpoint: process.env.BOARD_ENDPOINT ?? HOSTED_ENDPOINT,
  });

  process.stdout.write(`OK board -> ${report.indexPath} (data: ${source})\n`);
  for (const route of report.pages) process.stdout.write(`OK page  -> ${route}\n`);

  // Never silent: the board links to these routes, so a reader would click
  // through to a 404. A named warning rather than a failed build, because a
  // board whose cards carry no page copy is a valid state.
  for (const { id, reason } of report.unbuildable) {
    process.stderr.write(`WARN ${id}: no page could be derived -- ${reason}\n`);
  }
}

/** True only when this module is the process entrypoint, never when imported
 *  by a test -- resolved through the filesystem/URL machinery rather than raw
 *  string comparison, because this repo's root contains a space. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    process.stderr.write(`build-site: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
