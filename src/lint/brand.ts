import type { VocabSwap } from "./vocabulary.js";
import { parseVocabulary } from "./vocabulary.js";

export type { VocabSwap };
export { parseVocabulary };

export interface LintFinding {
  readonly rule: number;
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
 */
const AI_TELLS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /in today['’]s (?:fast-paced|rapidly evolving|ever-changing)/i, label: "stock opener" },
  // Requires an article ("a "/"an ") before the first clause and excludes
  // sentence/line terminators (comma, period, newline, "!", "?", ";") from
  // the window so it cannot cross a clause or line boundary. The mandatory
  // article also keeps this from firing on a plain factual "it's not
  // <adjective>, it's <fact>" sentence (e.g. a price statement), which has
  // no article on either side, while still matching the genuine
  // "it's not a/an X, it's a/an Y" marketing tell.
  {
    pattern: /it['’]s not (?:just )?(?:a |an )[^,.\n!?;]{1,30}, it['’]s/i,
    label: "contrast framing",
  },
  { pattern: /\bnot only\b[^.]{0,60}\bbut also\b/i, label: "negative parallelism" },
  { pattern: /\bin the (?:ever-)?evolving landscape\b/i, label: "landscape cliche" },
  { pattern: /\bis a testament to\b/i, label: "testament cliche" },
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
        message: `Rule 8 CTA: "${m[0]}" is not an action. Use a verb the reader can do now.`,
        excerpt: excerpt(text, m.index, m[0].length),
      });
    }
  }

  return findings;
}
