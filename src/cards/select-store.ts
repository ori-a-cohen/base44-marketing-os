import { JsonlCardStore, type CardStore } from "./card-store.js";
import { createBase44CardStore } from "./base44-card-store.js";
import type { AsyncCardStore } from "./async-card-store.js";

export type StoreDriver = "jsonl" | "base44";

/**
 * A discriminated result rather than a bare union of stores: `jsonl` and
 * `base44` return different interfaces (sync `CardStore` vs `AsyncCardStore`),
 * and a caller must be able to tell which one it got without a runtime
 * capability check. This selector is for call sites that can await; every
 * existing synchronous caller (metric, board compute, server, reconcile,
 * the CLIs) keeps constructing `JsonlCardStore` directly and never calls
 * this function, so nothing forces them onto the async path.
 */
export type SelectedCardStore =
  | { readonly driver: "jsonl"; readonly store: CardStore }
  | { readonly driver: "base44"; readonly store: AsyncCardStore };

function readDriver(): StoreDriver {
  const raw = process.env.ROUNDTRIP_STORE;
  if (raw === undefined || raw === "jsonl") return "jsonl";
  if (raw === "base44") return "base44";
  throw new Error(`ROUNDTRIP_STORE must be "jsonl" or "base44", received: ${raw}`);
}

/**
 * Selects a `CardStore` driver from the `ROUNDTRIP_STORE` environment
 * variable (default `jsonl`). Reads env only when called, never at module
 * load, so importing this module is as inert as importing `card-store.ts`
 * or `base44-card-store.ts` -- the cold-run-with-zero-keys guarantee holds
 * transitively through the selector.
 *
 * `jsonlPath` is required unconditionally (rather than only when the
 * `jsonl` driver is selected) so a caller can construct the arguments
 * before knowing which driver will be chosen.
 */
export function selectCardStore(jsonlPath: string): SelectedCardStore {
  const driver = readDriver();
  if (driver === "jsonl") {
    return { driver: "jsonl", store: new JsonlCardStore(jsonlPath) };
  }
  const appId = process.env.BASE44_APP_ID;
  if (!appId) {
    throw new Error("ROUNDTRIP_STORE=base44 requires BASE44_APP_ID to be set");
  }
  return { driver: "base44", store: createBase44CardStore(appId) };
}
