import type { Card } from "./schema.js";

/**
 * The async counterpart to `CardStore` (card-store.ts). The Base44 SDK's
 * entity operations are all promise-based, so a hosted driver cannot
 * implement the synchronous `CardStore` interface -- this interface exists
 * so a hosted driver has a contract to implement without forcing every
 * existing synchronous caller (metric, board compute, server, reconcile,
 * the CLIs) onto an async path they never asked for. `CardStore` and
 * `AsyncCardStore` are deliberately two separate interfaces, not one
 * interface unioning sync and async signatures: a caller that only ever
 * runs against JSONL keeps calling `read()` and getting an array back,
 * with no `await` forced into code that doesn't need one.
 */
export interface AsyncCardStore {
  /** All rows, in log order. Same semantics as `CardStore.read`. */
  read(): Promise<Card[]>;
  /** Appends a row. Same semantics as `CardStore.append`. */
  append(card: Card): Promise<void>;
  /** Replaces the row matching id+version, or appends. Same semantics as `CardStore.upsert`. */
  upsert(card: Card): Promise<void>;
}
