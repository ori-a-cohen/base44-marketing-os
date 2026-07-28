import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Font resolution for the *page* renderer, which is a different problem from
 * card-image.ts's resolution for satori even though both read the same
 * directory.
 *
 * satori rasterises in-process: it needs real bytes for any face it draws,
 * and those bytes never leave the machine, so falling back to a system font
 * file is free. A landing page is a document that ships. Embedding a face
 * into it redistributes that face, so this module will only ever embed what
 * `assets/fonts/` holds -- Geist, which is SIL Open Font License and
 * explicitly safe to redistribute (see scripts/fetch-fonts.sh). Dazzed's
 * licence forbids redistribution and it is never fetched, so in practice it
 * is never present here; the lookup stays in place so a licensed checkout
 * gets it for free.
 *
 * A face this module cannot resolve is simply absent from the result.
 * `renderPage` then names the token family in the CSS stack without an
 * @font-face backing it -- the browser uses it if the visitor happens to
 * have it installed, and drops to the next entry if not. What it must never
 * do is ship someone else's font file.
 */

/** One face the page can carry inline, with its bytes already base64-encoded. */
export interface EmbeddedFace {
  readonly family: string;
  readonly weight: 400 | 700;
  readonly base64: string;
}

/**
 * The faces a page can embed. Either key may be absent: a cold clone that
 * never ran scripts/fetch-fonts.sh resolves neither, which is a supported
 * state, not an error.
 */
export interface PageFonts {
  readonly display?: EmbeddedFace;
  readonly body?: EmbeddedFace;
  /**
   * The licence notice that must travel with the embedded bytes. OFL 1.1
   * permits redistribution on the condition that the copyright notice and
   * licence accompany the copy; assets/fonts/OFL.txt discharges that for the
   * repo, but a page that inlines the font software is an independently
   * distributed artifact and has to carry it too.
   *
   * Read from the licence file next to the fonts, never hardcoded: a
   * remembered notice would keep asserting Geist's terms over whatever face
   * a future assets/fonts/ actually holds. Absent when nothing was embedded,
   * and absent when the faces exist but no licence file sits beside them --
   * that second case is a state the operator should see, not one this module
   * papers over.
   */
  readonly notice?: string;
}

/** Licence files looked for beside the fonts, in order. */
const LICENCE_FILES: readonly string[] = ["OFL.txt", "LICENSE.txt", "LICENSE"];

/**
 * The first two non-empty lines of the licence file -- in every OFL-licensed
 * family that is the copyright line and the "licensed under" sentence, which
 * is exactly what the condition asks to travel with the bytes. The full text
 * stays in assets/fonts/ and is not inlined into every page.
 */
function readNotice(fontsDir: string): string | undefined {
  for (const name of LICENCE_FILES) {
    const path = join(fontsDir, name);
    if (!existsSync(path)) continue;
    try {
      const lines = readFileSync(path, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length === 0) return undefined;
      return lines.slice(0, 2).join(" ");
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export const DEFAULT_FONTS_DIR = "assets/fonts";

/**
 * Finds `<fontsDir>/<prefix>-*.ttf`, preferring the named weight variant and
 * falling back to the first match alphabetically. Returns undefined -- never
 * throws -- when the directory is absent, unreadable, or has no match, all
 * of which are ordinary cold-run states.
 *
 * Deliberately a separate implementation from card-image.ts's `findAssetFont`
 * rather than a shared export: that one always prefers "-Regular" because
 * satori synthesises weight itself, whereas a browser does not, so the page's
 * display face must actually be the Bold file to render bold. Sharing the
 * function would mean one caller silently getting the wrong preference.
 */
function findFace(fontsDir: string, prefix: string, preferWeight: "Regular" | "Bold"): string | undefined {
  if (!existsSync(fontsDir)) return undefined;
  let entries: readonly string[];
  try {
    entries = readdirSync(fontsDir);
  } catch {
    return undefined;
  }
  const lowerPrefix = `${prefix.toLowerCase()}-`;
  const matches = entries
    .filter((name) => name.toLowerCase().startsWith(lowerPrefix) && name.toLowerCase().endsWith(".ttf"))
    .slice()
    .sort();
  if (matches.length === 0) return undefined;
  const preferred = new RegExp(`-${preferWeight}\\.ttf$`, "i");
  return matches.find((name) => preferred.test(name)) ?? matches[0];
}

function loadFace(
  fontsDir: string,
  prefixesInOrder: readonly string[],
  preferWeight: "Regular" | "Bold",
  weight: 400 | 700,
): EmbeddedFace | undefined {
  for (const prefix of prefixesInOrder) {
    const fileName = findFace(fontsDir, prefix, preferWeight);
    if (!fileName) continue;
    try {
      const bytes = readFileSync(join(fontsDir, fileName));
      return { family: prefix, weight, base64: bytes.toString("base64") };
    } catch {
      // An unreadable file is the same outcome as an absent one: this face
      // does not get embedded. Never fabricate a face, never throw -- a
      // permissions problem in assets/ must not take a build down.
      return undefined;
    }
  }
  return undefined;
}

/**
 * Resolves the faces a rendered page can carry inline.
 *
 * - display: Dazzed -> Geist, preferring the Bold file
 * - body: Geist only, preferring the Regular file. Dazzed is display-only per
 *   brand/DESIGN.md's typography tokens and is never consulted for body copy.
 */
export function resolveWebFonts(fontsDir: string = DEFAULT_FONTS_DIR): PageFonts {
  const display = loadFace(fontsDir, ["Dazzed", "Geist"], "Bold", 700);
  const body = loadFace(fontsDir, ["Geist"], "Regular", 400);

  // Only when something is actually being redistributed: a notice attached
  // to a page carrying no font bytes would claim a licence obligation that
  // does not exist.
  const notice = display || body ? readNotice(fontsDir) : undefined;

  return {
    ...(display ? { display } : {}),
    ...(body ? { body } : {}),
    ...(notice ? { notice } : {}),
  };
}
