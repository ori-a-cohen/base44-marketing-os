import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { DesignTokens } from "../lint/tokens.js";
import { MARKER_TEXT } from "./page.js";

export interface CardImageSpec {
  readonly headline: string;
  readonly kicker: string;
  readonly cardId: string;
}

const WIDTH = 1200;
const HEIGHT = 630;

/**
 * Resolved relative to this module file, then converted with `fileURLToPath`
 * -- never `.pathname` -- so the repo root's space in "Base44 MarketingOS"
 * resolves correctly instead of surviving as a literal `%20` that makes
 * `existsSync` silently return false. That exact bug has bitten this repo
 * twice already (see src/lint/cli-brand.ts / cli-design.ts comments).
 */
const DEFAULT_FONTS_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

/**
 * Amendment A (task-13): Dazzed is licensed for use but not for
 * redistribution, so it can never be committed to this repo. Geist (SIL
 * Open Font License) is committed-by-download instead, via
 * `scripts/fetch-fonts.sh`. `assets/fonts/` itself is gitignored, so a
 * fresh clone starts with neither face present -- see the cold-run tests in
 * tests/render/card-image.test.ts for the contract this resolves.
 */
export interface FontUsed {
  readonly display: string;
  readonly body: string;
}

interface ResolvedFace {
  readonly label: string;
  readonly filePath: string;
}

interface SystemFontCandidate {
  readonly filePath: string;
  readonly label: string;
}

/**
 * Known, single-font (never `.ttc`) system font files, checked in order.
 * `.ttc` "TrueType Collection" containers are deliberately excluded: satori's
 * bundled font parser (`@shuding/opentype.js`) reads standalone sfnt files,
 * not the multi-font `.ttc` wrapper, so listing one here would look like a
 * usable candidate and then fail at render time -- worse than not listing it.
 * This list exists purely so a cold checkout (no assets/fonts/ downloads)
 * can still render something on a real developer machine or CI image; it is
 * intentionally injectable (see `resolveFonts`'s second parameter) so the
 * "nothing is available anywhere" failure path is actually testable without
 * uninstalling fonts from the host running the test suite.
 */
const SYSTEM_FONT_CANDIDATES: readonly SystemFontCandidate[] = [
  { filePath: "/System/Library/Fonts/Supplemental/Arial.ttf", label: "System (Arial)" },
  { filePath: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", label: "System (Arial Unicode)" },
  { filePath: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", label: "System (DejaVu Sans)" },
  { filePath: "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", label: "System (Liberation Sans)" },
  {
    filePath: "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    label: "System (Liberation Sans)",
  },
  { filePath: "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf", label: "System (Arial)" },
  { filePath: "C:\\Windows\\Fonts\\arial.ttf", label: "System (Arial)" },
];

const FETCH_FONTS_HELP =
  "No usable font found for Satori: assets/fonts/ has neither Dazzed nor Geist, and no known " +
  "system font file was found either. Run `scripts/fetch-fonts.sh` to download Geist (SIL Open " +
  "Font License, safe to redistribute) into assets/fonts/, or install a system TTF font, then retry.";

/**
 * Finds `assets/fonts/<prefix>-*.ttf`, preferring a "-Regular" weight when
 * more than one file matches. Returns `undefined` -- never throws -- when
 * the directory is absent, unreadable, or has no match: every one of those
 * is a normal cold-run state, not an error condition.
 */
function findAssetFont(fontsDir: string, prefix: string): string | undefined {
  if (!existsSync(fontsDir)) return undefined;
  let entries: string[];
  try {
    entries = readdirSync(fontsDir);
  } catch {
    return undefined;
  }
  const lowerPrefix = `${prefix.toLowerCase()}-`;
  const matches = entries
    .filter((name) => name.toLowerCase().startsWith(lowerPrefix) && name.toLowerCase().endsWith(".ttf"))
    .sort();
  if (matches.length === 0) return undefined;
  return matches.find((name) => /-regular\.ttf$/i.test(name)) ?? matches[0];
}

function resolveSystemFallback(candidates: readonly SystemFontCandidate[]): ResolvedFace | undefined {
  const found = candidates.find((c) => existsSync(c.filePath));
  return found ? { label: found.label, filePath: found.filePath } : undefined;
}

/**
 * Resolves one face: walks `assetPrefixesInOrder` against
 * `assets/fonts/<Prefix>-*.ttf`, then a fixed list of known system font
 * files, in that order. Throws only when every tier is empty -- the
 * genuinely cold-and-fontless case the task brief calls out explicitly:
 * Satori cannot render a single glyph without at least one real font, so
 * there is no further degradation available once this point is reached.
 */
function resolveFace(
  fontsDir: string,
  assetPrefixesInOrder: readonly string[],
  systemFontCandidates: readonly SystemFontCandidate[],
): ResolvedFace {
  for (const prefix of assetPrefixesInOrder) {
    const fileName = findAssetFont(fontsDir, prefix);
    if (fileName) return { label: prefix, filePath: join(fontsDir, fileName) };
  }
  const fallback = resolveSystemFallback(systemFontCandidates);
  if (fallback) return fallback;
  throw new Error(FETCH_FONTS_HELP);
}

type FontWeight = 400 | 700;
interface LoadedFont {
  readonly name: "display" | "body";
  readonly data: Buffer;
  readonly weight: FontWeight;
  readonly style: "normal";
}

export interface FontResolution {
  readonly fonts: readonly LoadedFont[];
  readonly fontUsed: FontUsed;
}

/**
 * Resolution order, per Amendment A:
 *  - display: assets/fonts/Dazzed-*.ttf -> assets/fonts/Geist-*.ttf -> system
 *  - body: assets/fonts/Geist-*.ttf -> system (Dazzed is display-only per
 *    brand/DESIGN.md's typography tokens and is never consulted for body copy)
 *
 * `fontsDir` and `systemFontCandidates` default to the real locations but
 * are overridable so tests can exercise every tier (including "nothing
 * anywhere" -> throw) deterministically, without depending on the actual
 * repo checkout state or the host machine's installed fonts.
 */
export function resolveFonts(
  fontsDir: string = DEFAULT_FONTS_DIR,
  systemFontCandidates: readonly SystemFontCandidate[] = SYSTEM_FONT_CANDIDATES,
): FontResolution {
  const display = resolveFace(fontsDir, ["Dazzed", "Geist"], systemFontCandidates);
  const body = resolveFace(fontsDir, ["Geist"], systemFontCandidates);

  return {
    fonts: [
      { name: "display", data: readFileSync(display.filePath), weight: 700, style: "normal" },
      { name: "body", data: readFileSync(body.filePath), weight: 400, style: "normal" },
    ],
    fontUsed: { display: display.label, body: body.label },
  };
}

/** Strips a spacing token's unit ("32px" -> 32) for satori, which takes bare
 * numeric px values. Missing/malformed tokens degrade to 0 rather than
 * inventing a design value that isn't in the passed tokens.
 */
function pxNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Satori's own output always includes one `<mask id="..."><rect ...
 * fill="#fff"/></mask>` scaffold per flex box, regardless of whether that
 * box is ever actually clipped -- confirmed empirically against both a
 * normal card and a deliberately overflowing one (see the task-13 report):
 * the mask element exists every time, but nothing in the document ever
 * references it via `mask="url(#id)")`. That makes it dead markup, and it is
 * also the one place satori hardcodes a colour (`#fff`) regardless of the
 * tokens passed in -- which would otherwise permanently fail
 * `findOffTokenValues` on every satori-rendered card, no matter how
 * carefully every *visible* colour is token-derived.
 *
 * This removes a `<mask>` block only when its id is never referenced
 * anywhere else in the document. If a future satori version (or some
 * content shape not covered by this task's manual probes) ever does
 * reference one of these masks for a real clip, this leaves it alone --
 * silently breaking real clipping to satisfy a linter would be worse than
 * a design-lint finding surfacing that case for a human to look at.
 */
function stripUnusedSatoriMasks(svg: string): string {
  const maskBlockPattern = /<mask id="([^"]+)">[\s\S]*?<\/mask>/g;
  const blocksToRemove: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = maskBlockPattern.exec(svg)) !== null) {
    const block = match[0];
    const id = match[1];
    if (!id) continue;
    const restOfDocument = svg.slice(0, match.index) + svg.slice(match.index + block.length);
    if (!restOfDocument.includes(`mask="url(#${id})"`)) {
      blocksToRemove.push(block);
    }
  }
  return blocksToRemove.reduce((acc, block) => acc.replace(block, ""), svg);
}

/** Minimal XML-escape for the accessibility metadata injected below --
 * mirrors src/render/page.ts's esc() but is not imported from it, since that
 * one is HTML-specific (not exported) and this call site only ever escapes
 * into SVG <title>/<desc> text content. */
function escXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Satori always renders text as vector `<path>` outlines (confirmed
 * empirically -- see the task-13 report): that is exactly what lets its SVG
 * render identically with no font installed on the viewer, but it also means
 * none of the card's copy exists as a literal, searchable string anywhere in
 * satori's own output. A `<title>`/`<desc>` pair injected right after the
 * opening `<svg>` tag restores that -- a screen reader (or a human `grep`,
 * or a test) can read the card's actual content, while every visible pixel
 * is still rendered by satori from the same tokens. This is also standard
 * SVG accessibility practice for a non-decorative image, not a workaround
 * invented only to satisfy a test: an image-only card with no text
 * alternative is inaccessible regardless of what testing does or doesn't
 * check for.
 *
 * The marker text is carried byte-exact (see MARKER_TEXT's own contract in
 * page.ts) inside `<desc>`; escXml only escapes `&<>"'`, none of which
 * appear in MARKER_TEXT, so the em dash and every other character survive
 * unchanged.
 */
function injectAccessibleMetadata(svg: string, spec: CardImageSpec): string {
  const title = escXml(spec.headline);
  const desc = escXml(`${spec.kicker} — ${MARKER_TEXT}`);
  return svg.replace(/^(<svg[^>]*>)/, `$1<title>${title}</title><desc>${desc}</desc>`);
}

export interface CardSvgResult {
  readonly svg: string;
  readonly fontUsed: FontUsed;
}

export interface CardPngResult {
  readonly png: Buffer;
  readonly fontUsed: FontUsed;
}

/**
 * DESIGN.md: "Rendering them is deterministic work -> a script, not a
 * conversation: tokens + HTML template + screenshot = the same on-brand card
 * every time." Satori does this without a headless browser.
 *
 * `fontsDir` is exposed as a parameter (default: the real assets/fonts/) so
 * tests can point it at a fixture directory instead -- see
 * tests/render/card-image.test.ts. It is not part of `CardImageSpec`
 * because it is a render-environment concern, not a per-card content field.
 */
export async function renderCardSvg(
  spec: CardImageSpec,
  tokens: DesignTokens,
  fontsDir: string = DEFAULT_FONTS_DIR,
): Promise<CardSvgResult> {
  const c = tokens.colors;
  const s = tokens.spacing;
  const { fonts, fontUsed } = resolveFonts(fontsDir);
  const padding = pxNumber(s.lg);

  // Headline uses the "display" face (Dazzed, or its labelled fallback);
  // kicker and marker use "body" (Geist, or its labelled fallback) --
  // matching brand/DESIGN.md's typography contract: "Display face for
  // headlines only, body face for everything else."
  const node = {
    type: "div",
    props: {
      style: {
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: c.background,
        padding,
      },
      children: [
        {
          type: "div",
          props: {
            style: { fontFamily: "body", fontSize: 28, color: c.primary, letterSpacing: 2 },
            children: spec.kicker,
          },
        },
        {
          type: "div",
          props: {
            style: { fontFamily: "display", fontSize: 72, color: c.ink, lineHeight: 1.1 },
            children: spec.headline,
          },
        },
        {
          type: "div",
          props: {
            style: { fontFamily: "body", fontSize: 20, color: c.muted },
            children: MARKER_TEXT,
          },
        },
      ],
    },
  };

  // `node` is a plain object literal built without JSX, so it does not
  // structurally match satori's `ReactNode` parameter type; `fonts` matches
  // satori's `FontOptions[]` shape exactly and needs no cast. `never` (not
  // `any`) is the narrowest cast that still compiles, consistent with the
  // rest of this codebase's existing satori call sites.
  const rawSvg = await satori(node as never, { width: WIDTH, height: HEIGHT, fonts: [...fonts] });
  const svg = injectAccessibleMetadata(stripUnusedSatoriMasks(rawSvg), spec);
  return { svg, fontUsed };
}

export async function renderCardPng(
  spec: CardImageSpec,
  tokens: DesignTokens,
  fontsDir: string = DEFAULT_FONTS_DIR,
): Promise<CardPngResult> {
  const { svg, fontUsed } = await renderCardSvg(spec, tokens, fontsDir);
  const png = Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng());
  return { png, fontUsed };
}
