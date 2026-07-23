import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Card, parseCard } from "./schema.js";

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function readCards(path: string): Card[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseCard(JSON.parse(line) as unknown));
}

export function appendCard(path: string, card: Card): void {
  ensureDir(path);
  appendFileSync(path, `${JSON.stringify(card)}\n`, "utf8");
}

/** Replaces the row matching both id and version; appends if absent. */
export function upsertCard(path: string, card: Card): void {
  const cards = readCards(path);
  const idx = cards.findIndex((c) => c.id === card.id && c.version === card.version);
  const next = idx === -1 ? [...cards, card] : cards.map((c, i) => (i === idx ? card : c));
  ensureDir(path);
  writeFileSync(path, next.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");
}

/**
 * A material change to a card produces a NEW version with its own measurement
 * window, so outcome data from before and after a change is never pooled.
 */
export function nextVersion(card: Card): Card {
  const version = card.version + 1;
  return {
    ...card,
    version,
    status: "drafted",
    outcome: null,
    shipped_at: null,
    verdicts: [],
    history: [...card.history, `version ${version}: regenerated after upstream change`],
  };
}
