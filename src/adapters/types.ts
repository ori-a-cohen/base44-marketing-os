import type { Outcome } from "../cards/schema.js";

export type AdapterStatus = "live" | "stub";

/**
 * A stub must explain itself; a live adapter must not carry a stray
 * explanation. Modeled as a discriminated union on `status` so "why is this
 * unavailable" is a compile-time-required field on the stub branch, not an
 * optional string a caller can forget to set or a live adapter can leak.
 */
export type AdapterAvailability =
  | { readonly status: "stub"; readonly unavailableReason: string }
  | { readonly status: "live" };

/**
 * The one contract every outcome source satisfies. This single shape is what
 * makes channels pluggable and per-surface scoring possible without
 * special-casing any individual platform.
 */
export type OutcomeAdapter = {
  readonly id: string;
  readonly surface: string;
  /** Never throws for missing credentials. A stub returns [] and explains itself. */
  fetch(cardIds: readonly string[]): Promise<Outcome[]>;
} & AdapterAvailability;

/**
 * Builds a credential-gated adapter such that the safe path is the only
 * path: an author cannot produce an adapter that throws at construction,
 * because this helper is the only way to construct one.
 *
 * - If any of `requiredEnv` is unset, returns a labelled stub naming the
 *   missing variables -- `build` is never even called.
 * - If all are present, calls `build` with those values. If `build` itself
 *   throws (bad credentials shape, a misconfigured client, anything),
 *   the error is caught here and turned into a stub explaining the failure,
 *   never propagated -- construction can never throw at startup.
 */
export function credentialGatedAdapter(config: {
  readonly id: string;
  readonly surface: string;
  readonly requiredEnv: readonly string[];
  readonly build: (env: Readonly<Record<string, string>>) => Pick<OutcomeAdapter, "fetch">;
}): OutcomeAdapter {
  const { id, surface, requiredEnv, build } = config;
  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    const noun = missing.length === 1 ? "variable" : "variables";
    return {
      id,
      surface,
      status: "stub",
      unavailableReason: `missing environment ${noun}: ${missing.join(", ")}`,
      fetch: async () => [],
    };
  }

  const env = Object.fromEntries(requiredEnv.map((name) => [name, process.env[name] as string]));

  try {
    const { fetch } = build(env);
    return { id, surface, status: "live", fetch };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id,
      surface,
      status: "stub",
      unavailableReason: `adapter construction failed: ${message}`,
      fetch: async () => [],
    };
  }
}
