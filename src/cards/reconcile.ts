import { existsSync, readFileSync } from "node:fs";
import { readCards, appendCard } from "./store.js";
import { parseCard, type Card } from "./schema.js";

/**
 * The guardian emits a verdict block; this is the shape reconcile looks for.
 * Task 18 defines the agents that emit this text -- keep this pattern in
 * sync with the verdict block those agents produce (see this task's report
 * for the exact shape this regex expects).
 */
const VERDICT_RE =
  /VERDICT:\s*(APPROVED|REJECTED)\s+score\s+([\d.]+)\s+card-id:\s*([\w-]+)\s+channel:\s*([\w-]+)/gi;

export interface ReconcileResult {
  readonly created: readonly string[];
  readonly flagged: readonly string[];
}

interface VerdictMatch {
  readonly outcome: string;
  readonly score: number;
  readonly id: string;
  readonly channel: string;
}

/**
 * Reads a Claude Code transcript (one JSON object per line, Stop-hook
 * `transcript_path` shape) and flattens every assistant text block into a
 * single string to scan for verdicts. Tolerates a missing file and
 * malformed lines -- a transcript is untrusted input by the time a Stop
 * hook sees it, and a corrupt line must never take the whole scan down.
 */
function transcriptText(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      try {
        const entry = JSON.parse(line) as { message?: { content?: { text?: string }[] } };
        return (entry.message?.content ?? []).map((c) => c.text ?? "").join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");
}

/** Every VERDICT block in `text`, in document order. Never throws. */
function parseVerdicts(text: string): VerdictMatch[] {
  const matches: VerdictMatch[] = [];
  VERDICT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VERDICT_RE.exec(text)) !== null) {
    const [, outcome, score, id, channel] = m as unknown as [string, string, string, string, string];
    matches.push({ outcome, score: Number(score), id, channel });
  }
  return matches;
}

/**
 * The ids named in a guardian verdict block that have no corresponding
 * card in `cards`, deduped and in first-seen order. Pure and side-effect
 * free -- `reconcile` below is the only caller that acts on the result.
 */
export function findVerdictsWithoutCards(transcript: string, cards: readonly Card[]): string[] {
  const existing = new Set(cards.map((c) => c.id));
  const missing: string[] = [];
  for (const v of parseVerdicts(transcript)) {
    if (!existing.has(v.id) && !missing.includes(v.id)) missing.push(v.id);
  }
  return missing;
}

/**
 * No silent runs: a guardian verdict that produced no card is a hole in the
 * record. This closes it after the fact rather than trusting every path to
 * log. Idempotent by construction -- a verdict id already present in the
 * card store (whether from a prior run of this same hook or from the
 * writer/guardian flow itself) is never re-created; re-running reconcile
 * on the same transcript against the same store is always a no-op on the
 * second pass.
 */
export function reconcile(transcriptPath: string, cardsPath: string): ReconcileResult {
  const text = transcriptText(transcriptPath);
  const existing = new Set(readCards(cardsPath).map((c) => c.id));
  const created: string[] = [];
  const flagged: string[] = [];

  for (const v of parseVerdicts(text)) {
    if (existing.has(v.id)) continue;
    appendCard(
      cardsPath,
      parseCard({
        id: v.id,
        channel: v.channel,
        surface: v.channel,
        topic: "reconciled from transcript",
        status: v.outcome.toUpperCase() === "APPROVED" ? "approved" : "drafted",
        created: new Date().toISOString().slice(0, 10),
        guardian_score: v.score,
        history: ["created by reconcile hook: verdict had no card"],
      }),
    );
    existing.add(v.id);
    created.push(v.id);
    flagged.push(`${v.id}: verdict existed with no card, created by reconciliation`);
  }
  return { created, flagged };
}
