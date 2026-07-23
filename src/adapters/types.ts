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
 * A source of environment-like values. Defaults to the real `process.env`,
 * but callers may inject any object (or `null`/`undefined`) so the
 * stub-vs-live decision stays unit-testable without mutating global state.
 * Because it is caller-supplied, it is treated as untrusted: every read
 * goes through `readEnvValue`, which never lets a missing source or a
 * throwing getter escape as an exception.
 */
export type EnvSource = Readonly<Record<string, string | undefined>> | null | undefined;

/**
 * Reads a single key from a possibly-absent, possibly-hostile env source.
 * `source` may be `null`/`undefined` (optional chaining handles that), or a
 * plain object whose property access itself throws (a throwing getter,
 * a Proxy trap, anything) -- the try/catch handles that case. Either way
 * this returns `undefined` instead of propagating.
 */
function readEnvValue(source: EnvSource, name: string): string | undefined {
  try {
    return source?.[name];
  } catch {
    return undefined;
  }
}

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
 *
 * `envSource` defaults to the real `process.env`, so every existing caller
 * keeps reading real environment variables unchanged. Passing an explicit
 * source (a plain object, `undefined`, `null`, or something with hostile
 * getters) lets a caller drive the same env-check and try/catch path with
 * injected values -- reading it can never throw, see `readEnvValue`.
 */
export function credentialGatedAdapter(config: {
  readonly id: string;
  readonly surface: string;
  readonly requiredEnv: readonly string[];
  readonly build: (env: Readonly<Record<string, string>>) => Pick<OutcomeAdapter, "fetch">;
  readonly envSource?: EnvSource;
}): OutcomeAdapter {
  const { id, surface, requiredEnv, build, envSource = process.env } = config;

  const entries = requiredEnv.map((name) => [name, readEnvValue(envSource, name)] as const);
  const missing = entries.filter(([, value]) => !value).map(([name]) => name);

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

  const env = entries.reduce<Record<string, string>>((acc, [name, value]) => {
    if (!value) {
      return acc;
    }
    return { ...acc, [name]: value };
  }, {});

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
