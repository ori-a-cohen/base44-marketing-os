import { readCards, appendCard, upsertCard } from "./store.js";
import type { Card } from "./schema.js";

/**
 * The storage contract every card driver implements: read the full
 * append-only log, append a row, or upsert (replace-by-identity,
 * atomically) a row. A driver holds its own location (a file path, a
 * hosted entity endpoint, whatever) internally, so these methods take no
 * location argument -- that is what lets a second driver (a Base44 hosted
 * entity store) slot in behind the same contract without a rewrite.
 */
export interface CardStore {
  /** All rows, in log order. Same semantics as `readCards`. */
  read(): Card[];
  /** Appends a row. Same semantics as `appendCard`. */
  append(card: Card): void;
  /** Replaces the row matching id+version, or appends. Same semantics as `upsertCard`. */
  upsert(card: Card): void;
}

/**
 * The default, cold-run driver: a JSONL file on disk. Every method
 * delegates to the free functions in store.ts, so there is exactly one
 * implementation of the JSONL read/append/upsert mechanics -- this class
 * adds no logic of its own, only binds a `path` so callers holding a
 * `CardStore` stop threading the path through every call. In particular
 * `upsert` inherits `upsertCard`'s same-directory-temp-file + `renameSync`
 * atomicity unchanged: this class never duplicates that logic, it only
 * calls it.
 */
export class JsonlCardStore implements CardStore {
  constructor(private readonly path: string) {}

  read(): Card[] {
    return readCards(this.path);
  }

  append(card: Card): void {
    appendCard(this.path, card);
  }

  upsert(card: Card): void {
    upsertCard(this.path, card);
  }
}
