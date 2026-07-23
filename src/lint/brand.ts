import type { VocabSwap } from "./vocabulary.js";
import { parseVocabulary } from "./vocabulary.js";

export type { VocabSwap };
export { parseVocabulary };

export interface LintFinding {
  readonly rule: number;
  readonly message: string;
  readonly excerpt: string;
}

/** Rule 7 — the AI tells named in brand/rules.md. */
const AI_TELLS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /in today's (?:fast-paced|rapidly evolving|ever-changing)/i, label: "stock opener" },
  { pattern: /it['’]s not (?:just )?(?:a |an )?[\w\s]{1,30}, it['’]s/i, label: "contrast framing" },
  { pattern: /\bnot only\b[^.]{0,60}\bbut also\b/i, label: "negative parallelism" },
  { pattern: /\bin the (?:ever-)?evolving landscape\b/i, label: "landscape cliche" },
  { pattern: /\bis a testament to\b/i, label: "testament cliche" },
];

/** Rule 8 — CTAs that are not actions the reader can take now. */
const WEAK_CTAS: readonly string[] = ["learn more", "find out more", "read more", "discover more", "click here"];

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  return text
    .slice(start, Math.min(text.length, index + length + 20))
    .replace(/\s+/g, " ")
    .trim();
}

export function lintBrand(text: string, vocab: readonly VocabSwap[]): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const swap of vocab) {
    const re = new RegExp(`\\b${escapeRegex(swap.never)}\\b`, "gi");
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
    const m = tell.pattern.exec(text);
    if (m) {
      findings.push({
        rule: 7,
        message: `Rule 7 AI tell (${tell.label}): "${m[0].trim()}". Rewrite without it.`,
        excerpt: excerpt(text, m.index, m[0].length),
      });
    }
  }

  const lower = text.toLowerCase();
  for (const cta of WEAK_CTAS) {
    const idx = lower.indexOf(cta);
    if (idx !== -1) {
      findings.push({
        rule: 8,
        message: `Rule 8 CTA: "${cta}" is not an action. Use a verb the reader can do now.`,
        excerpt: excerpt(text, idx, cta.length),
      });
    }
  }

  return findings;
}
