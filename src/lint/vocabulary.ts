/**
 * Parses the "we say / we never say" vocabulary table out of
 * brand/voice-guide.md into pairs the linter can check copy against.
 *
 * The real canon file packs multiple synonyms into each table cell,
 * separated by a middle dot (·) or commas, sometimes double-quoted, and
 * sometimes annotated with a trailing parenthetical aside (e.g.
 * `"easy for beginners" (condescending)`). Each cell can therefore hold
 * more than one term, and the two cells in a row are not a 1:1 pairing —
 * a row's "we say" terms are the suggested replacement for every one of
 * that row's "we never say" terms.
 */
export interface VocabSwap {
  readonly never: string;
  readonly instead: string;
}

/**
 * Splits one markdown table cell into its individual terms.
 * Strips surrounding double quotes and a trailing parenthetical note
 * (e.g. `(condescending)`) from each term.
 */
// Splitting on a literal comma means a banned phrase that itself contains a
// comma (e.g. "no-code, low-code") would be shredded into two separate,
// smaller terms instead of parsed as one. This is a constraint on canon
// authors, not something the parser can resolve on its own: brand/rules.md
// and brand/voice-guide.md must keep never-say phrases comma-free, or use
// the middle-dot (·) separator exclusively for that row.
function splitTerms(cell: string): readonly string[] {
  return cell
    .split(/[·,]/)
    .map((term) => term.replace(/"/g, "").trim())
    .map((term) => term.replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter((term) => term.length > 0);
}

/** Reads the "we say / we never say" table out of brand/voice-guide.md. */
export function parseVocabulary(voiceGuideMarkdown: string): readonly VocabSwap[] {
  const swaps: VocabSwap[] = [];

  for (const line of voiceGuideMarkdown.split("\n")) {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length !== 2) continue;

    const [sayCell, neverCell] = cells as [string, string];
    if (/^-+$/.test(sayCell) || /^-+$/.test(neverCell)) continue;
    if (/^we say$/i.test(sayCell)) continue;

    const sayTerms = splitTerms(sayCell);
    const neverTerms = splitTerms(neverCell);
    if (sayTerms.length === 0 || neverTerms.length === 0) continue;

    const instead = sayTerms.join(" / ");
    for (const never of neverTerms) {
      swaps.push({ never, instead });
    }
  }

  return swaps;
}
