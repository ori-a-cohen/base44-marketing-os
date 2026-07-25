import type { VocabSwap } from "./vocabulary.js";
import { parseVocabulary } from "./vocabulary.js";

export type { VocabSwap };
export { parseVocabulary };

/**
 * "block" findings are mechanically decidable: a literal term either
 * appears in the text or it does not, so the linter can stop the write.
 * "warn" findings require reading intent — telling a factual clarification
 * apart from an inflated rhetorical flourish is a judgment call, and that
 * call belongs to the LLM brand-guardian agent, not a regex. The mechanical
 * linter blocks what it can decide and defers the rest.
 */
export type LintSeverity = "block" | "warn";

export interface LintFinding {
  readonly rule: number;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly excerpt: string;
}

/**
 * Rule 7 — the AI tells named in brand/rules.md.
 *
 * These patterns never carry the "g" flag: a module-level RegExp with "g"
 * keeps mutable lastIndex state that would leak between separate lintBrand
 * calls. lintBrand builds a fresh global copy of each pattern per call
 * (see the loop below) instead, following the same per-call-construction
 * approach rule 2 already uses.
 *
 * Per-pattern severity:
 * - "stock opener" ("In today's fast-paced world..."): block. A fixed,
 *   rigid idiom with no ordinary factual reading — nobody opens a genuine
 *   factual sentence this way, so a match is unambiguous.
 * - "contrast framing" ("It's not X, it's Y"): warn. The exact same
 *   grammatical shape covers both a genuine rhetorical tell ("it's not
 *   marketing, it's storytelling") and an ordinary factual clarification
 *   ("it's not free, it's $20/month"). Telling them apart requires reading
 *   intent, which is the guardian's job, not the regex's.
 * - "negative parallelism" ("not only X but also Y"): warn. This is a
 *   common, entirely ordinary English construction for describing two true
 *   facts ("works not only on desktop but also on mobile") — it becomes an
 *   AI tell only when used for rhetorical inflation rather than a plain
 *   feature list, which the pattern alone cannot tell apart.
 * - "landscape cliche" ("in the (ever-)evolving landscape"): block. A
 *   fixed corporate-filler idiom with no factual-clarification reading —
 *   unlike contrast framing, there is no ordinary sentence shape this
 *   pattern also matches, so seeing it is decisive on its own.
 * - "testament cliche" ("is a testament to"): block. Also a fixed idiom
 *   string; it always functions as color/praise, never as a factual
 *   clarification that would need to be told apart from the tell.
 */
const AI_TELLS: readonly { pattern: RegExp; label: string; severity: LintSeverity }[] = [
  {
    pattern: /in today['’]s (?:fast-paced|rapidly evolving|ever-changing)/i,
    label: "stock opener",
    severity: "block",
  },
  // Excludes sentence/line terminators (comma, period, newline, "!", "?",
  // ";") from the window so a match can never cross a clause or line
  // boundary — a warning that spans two unrelated sentences would just be
  // noise. No article requirement: that narrowing is what made this pattern
  // miss the genuine tell ("it's not marketing, it's storytelling" has no
  // article on either side). Recall is restored here because this pattern
  // is "warn" severity now — a false positive on a factual clarification no
  // longer blocks anyone's work, it just surfaces a judgment call for the
  // guardian.
  {
    pattern: /it['’]s not (?:just )?[^,.\n!?;]{1,30}, it['’]s/i,
    label: "contrast framing",
    severity: "warn",
  },
  { pattern: /\bnot only\b[^.]{0,60}\bbut also\b/i, label: "negative parallelism", severity: "warn" },
  { pattern: /\bin the (?:ever-)?evolving landscape\b/i, label: "landscape cliche", severity: "block" },
  { pattern: /\bis a testament to\b/i, label: "testament cliche", severity: "block" },
];

/** Rule 8 — CTAs that are not actions the reader can take now. */
const WEAK_CTAS: readonly string[] = ["learn more", "find out more", "read more", "discover more", "click here"];

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a word-boundary-anchored regex source for a (possibly multi-word)
 * term. Splitting the term on whitespace and rejoining with "\s+" means a
 * banned or weak phrase still matches when the copy under review has extra
 * spaces between the words or wraps them across a line break.
 */
function buildTermPattern(term: string): string {
  const words = term.trim().split(/\s+/).map(escapeRegex);
  return `\\b${words.join("\\s+")}\\b`;
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  return text
    .slice(start, Math.min(text.length, index + length + 20))
    .replace(/\s+/g, " ")
    .trim();
}

export function lintBrand(text: string, vocab: readonly VocabSwap[]): readonly LintFinding[] {
  const findings: LintFinding[] = [];

  for (const swap of vocab) {
    const re = new RegExp(buildTermPattern(swap.never), "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        rule: 2,
        severity: "block",
        message: `Rule 2 vocabulary: "${m[0]}" is on the never-say list. Use "${swap.instead}".`,
        excerpt: excerpt(text, m.index, m[0].length),
      });
    }
  }

  for (const tell of AI_TELLS) {
    const re = new RegExp(tell.pattern.source, `${tell.pattern.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        rule: 7,
        severity: tell.severity,
        message: `Rule 7 AI tell (${tell.label}): "${m[0].trim()}". Rewrite without it.`,
        excerpt: excerpt(text, m.index, m[0].length),
      });
    }
  }

  for (const cta of WEAK_CTAS) {
    const re = new RegExp(buildTermPattern(cta), "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        rule: 8,
        severity: "block",
        message: `Rule 8 CTA: "${m[0]}" is not an action. Use a verb the reader can do now.`,
        excerpt: excerpt(text, m.index, m[0].length),
      });
    }
  }

  return findings;
}
