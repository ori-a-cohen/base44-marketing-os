import type { Outcome } from "../cards/schema.js";

export type AdapterStatus = "live" | "stub";

/**
 * The one contract every outcome source satisfies. This single shape is what
 * makes channels pluggable and per-surface scoring possible without
 * special-casing any individual platform.
 */
export interface OutcomeAdapter {
  readonly id: string;
  readonly surface: string;
  readonly status: AdapterStatus;
  /** Never throws for missing credentials. A stub returns [] and explains itself. */
  fetch(cardIds: readonly string[]): Promise<Outcome[]>;
  /** Human-readable reason this adapter is unavailable, when status is "stub". */
  readonly unavailableReason?: string;
}
