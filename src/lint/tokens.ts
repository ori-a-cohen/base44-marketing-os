import { parse as parseYaml } from "yaml";
import type { LintFinding } from "./brand.js";

export interface DesignTokens {
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
}

/** Strips a trailing "# comment" that sits outside quotes, then trims quotes. */
function cleanValue(value: unknown): string {
  return String(value).replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
}

function cleanGroup(group: unknown): Record<string, string> {
  if (typeof group !== "object" || group === null) return {};
  return Object.fromEntries(
    Object.entries(group as Record<string, unknown>).map(([k, v]) => [k, cleanValue(v)]),
  );
}

/**
 * Extracts and parses the YAML front matter out of a DESIGN.md file.
 *
 * Failure contract (binding): this function throws, unconditionally, in
 * every case where the front matter cannot be read as a token source. It
 * never swallows an error and never returns a partial/default `DesignTokens`
 * on its own. The three distinct throw cases are kept separate on purpose,
 * because "the canon is missing" and "the canon is malformed" are different
 * operational problems worth telling apart:
 *   - No `---`-fenced block at all -> "DESIGN.md has no YAML front matter".
 *   - A fenced block whose body is empty (`---\n---\n`) -> "DESIGN.md front
 *     matter is empty".
 *   - A fenced block with a non-empty body that is not valid YAML -> the
 *     underlying `yaml` package's parse error, unmodified.
 *
 * The project's binding constraint is that a missing or malformed DESIGN.md
 * must never crash the caller — but that degrade-and-continue behaviour is
 * the caller's responsibility, not this function's. Every caller of
 * `parseTokens` MUST wrap the call in a try/catch and fall back to a safe
 * default (e.g. empty token groups) rather than letting the exception
 * propagate. There is no caller in this module; the hook that will call this
 * (see the PreToolUse wiring) owns that catch.
 */
export function parseTokens(designMd: string): DesignTokens {
  const match = /^---\n([\s\S]*?)\n?---/.exec(designMd);
  if (!match) throw new Error("DESIGN.md has no YAML front matter");
  const rawBody = match[1] ?? "";
  if (rawBody.trim() === "") throw new Error("DESIGN.md front matter is empty");
  const doc = parseYaml(rawBody) as Record<string, unknown>;
  return {
    colors: cleanGroup(doc.colors),
    typography: cleanGroup(doc.typography),
    spacing: cleanGroup(doc.spacing),
  };
}

/**
 * CSS properties whose value position holds a colour. Restricting hex/rgb/
 * hsl detection to these positions (plus the SVG/HTML colour attributes
 * below) is what keeps the detector from firing on hex-shaped text that
 * is not a colour at all — an issue reference ("#123456"), a word that
 * happens to be hex-shaped ("#decade"), or a hex string sitting inside an
 * unrelated attribute (`id="#FF6A00"`). Longer/more specific names are
 * listed before their shorter prefixes for readability; regex backtracking
 * would find the right alternative either way.
 */
const CSS_COLOR_PROPERTY_NAMES = [
  "background-color",
  "background",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-color",
  "border",
  "outline-color",
  "outline",
  "stop-color",
  "color",
  "fill",
  "stroke",
  "box-shadow",
] as const;

/** SVG/HTML attributes whose value is a colour. */
const COLOR_ATTRIBUTE_NAMES = ["fill", "stroke", "stop-color"] as const;

interface ColorValueSpan {
  readonly value: string;
  readonly start: number;
}

/** Finds every `property: value` colour declaration in text, with the value's absolute offset. */
function collectDeclarationSpans(text: string): readonly ColorValueSpan[] {
  const re = new RegExp(`\\b(?:${CSS_COLOR_PROPERTY_NAMES.join("|")})\\s*:\\s*([^;\\n]+)`, "gi");
  const spans: ColorValueSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[1] ?? "";
    spans.push({ value, start: m.index + m[0].length - value.length });
  }
  return spans;
}

/** Finds every `attr="value"` / `attr='value'` colour attribute in text, with the value's absolute offset. */
function collectAttributeSpans(text: string): readonly ColorValueSpan[] {
  const re = new RegExp(`\\b(?:${COLOR_ATTRIBUTE_NAMES.join("|")})\\s*=\\s*(["'])([^"']*)\\1`, "gi");
  const spans: ColorValueSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[2] ?? "";
    // The match ends with the closing quote (1 char) right after the value,
    // so the value's offset within the match is length - 1 - value.length.
    spans.push({ value, start: m.index + m[0].length - 1 - value.length });
  }
  return spans;
}

function collectColorValueSpans(text: string): readonly ColorValueSpan[] {
  return [...collectDeclarationSpans(text), ...collectAttributeSpans(text)];
}

/** Same excerpt convention as src/lint/brand.ts: 20 chars of context each side. */
function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  return text
    .slice(start, Math.min(text.length, index + length + 20))
    .replace(/\s+/g, " ")
    .trim();
}

// None of these patterns carry the "g" flag at module scope — a shared
// mutable lastIndex would leak between unrelated calls to findOffTokenValues
// (see src/lint/brand.ts for the same convention). A fresh "g" copy is built
// per call at each use site below.
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/;
const RGB_PATTERN = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i;
const HSL_PATTERN = /hsla?\([^)]*\)/i;

function channelToHex(channel: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(channel)));
  return clamped.toString(16).padStart(2, "0");
}

// rule: 0 on every finding below means "derived from DESIGN.md's Colors/
// Layout/Elevation prose", not a numbered rule in brand/rules.md or
// DESIGN.md itself. Kept at 0 rather than invented to avoid colliding with
// (or implying parity with) an actual numbered brand rule; see brand.ts
// rule 2/7/8 for what a real numbered rule's finding looks like.

function findHexFindings(
  span: ColorValueSpan,
  text: string,
  allowedHex: ReadonlySet<string>,
): LintFinding[] {
  const re = new RegExp(HEX_PATTERN.source, "g");
  const findings: LintFinding[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(span.value)) !== null) {
    const hex = m[0].toLowerCase();
    if (allowedHex.has(hex)) continue;
    const index = span.start + m.index;
    findings.push({
      rule: 0,
      severity: "block",
      message: `Off-token colour ${m[0]}. DESIGN.md allows only: ${[...allowedHex].join(", ")}.`,
      excerpt: excerpt(text, index, m[0].length),
    });
  }
  return findings;
}

/**
 * rgb()/rgba() are normalised to a hex triplet and compared against the same
 * allow-list as literal hex values, so a functional-notation spelling of a
 * canon colour (e.g. `rgb(255, 106, 0)` for `#FF6A00`) is recognised as
 * on-token. A non-opaque alpha (`rgba(..., 0.5)`) is deliberately always
 * treated as off-token, even when the RGB channels match a canon colour
 * exactly: DESIGN.md's Colors/Elevation sections specify solid, flat colours
 * with no elevation or translucency, so a translucent variant is a different
 * visual result from the opaque token regardless of channel equality. This
 * is a documented policy choice, not an oversight — see the probe/tests for
 * the exact case it covers.
 */
function findRgbFindings(
  span: ColorValueSpan,
  text: string,
  allowedHex: ReadonlySet<string>,
): LintFinding[] {
  const re = new RegExp(RGB_PATTERN.source, "gi");
  const findings: LintFinding[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(span.value)) !== null) {
    const r = Number(m[1] ?? 0);
    const g = Number(m[2] ?? 0);
    const b = Number(m[3] ?? 0);
    const hasAlpha = m[4] !== undefined;
    const alpha = hasAlpha ? Number(m[4]) : 1;
    const normalizedHex = `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
    const isOpaque = alpha >= 1;
    if (isOpaque && allowedHex.has(normalizedHex.toLowerCase())) continue;
    const index = span.start + m.index;
    const message = isOpaque
      ? `Off-token colour ${m[0]} (normalises to ${normalizedHex}). DESIGN.md allows only: ${[...allowedHex].join(", ")}.`
      : `Off-token colour ${m[0]}: translucent colours are treated as off-token even when the RGB channels match a canon colour, because DESIGN.md defines solid colours only.`;
    findings.push({
      rule: 0,
      severity: "block",
      message,
      excerpt: excerpt(text, index, m[0].length),
    });
  }
  return findings;
}

/**
 * hsl()/hsla() are never compared against the canon: converting HSL to the
 * canon's hex space correctly (matching CSS's own hue/saturation/lightness
 * math) is more implementation work than this detector's value justifies,
 * and the canon is expressed in hex — a creative should express colour in
 * the canon's own notation (hex or rgb()) rather than one the linter has to
 * translate. Every hsl()/hsla() value is therefore treated as off-token
 * unconditionally, and the finding message says so explicitly.
 */
function findHslFindings(span: ColorValueSpan, text: string): LintFinding[] {
  const re = new RegExp(HSL_PATTERN.source, "gi");
  const findings: LintFinding[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(span.value)) !== null) {
    const index = span.start + m.index;
    findings.push({
      rule: 0,
      severity: "block",
      message: `Off-token colour notation ${m[0]}: hsl()/hsla() is not compared against the canon (DESIGN.md's tokens are hex). Use the canon's hex value or an equivalent rgb() instead.`,
      excerpt: excerpt(text, index, m[0].length),
    });
  }
  return findings;
}

export function findOffTokenValues(text: string, tokens: DesignTokens): readonly LintFinding[] {
  const allowedHex = new Set(Object.values(tokens.colors).map((c) => c.toLowerCase()));
  const findings: LintFinding[] = [];

  for (const span of collectColorValueSpans(text)) {
    findings.push(...findHexFindings(span, text, allowedHex));
    findings.push(...findRgbFindings(span, text, allowedHex));
    findings.push(...findHslFindings(span, text));
  }

  if (/linear-gradient|radial-gradient|conic-gradient/i.test(text)) {
    findings.push({
      rule: 0,
      severity: "block",
      message: "Gradients are a DESIGN.md violation: flat, branded backgrounds only.",
      excerpt: "gradient",
    });
  }

  if (/box-shadow\s*:\s*(?!none)/i.test(text)) {
    findings.push({
      rule: 0,
      severity: "block",
      message: "No elevation: DESIGN.md forbids drop shadows and floating panels.",
      excerpt: "box-shadow",
    });
  }

  return findings;
}
