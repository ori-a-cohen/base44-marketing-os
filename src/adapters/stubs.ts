import type { OutcomeAdapter } from "./types.js";

type Env = Record<string, string | undefined>;

/**
 * Both adapters below deliberately do not call credentialGatedAdapter
 * (src/adapters/types.ts, Task 10). That helper is the right shape for a
 * production adapter that is wired once at startup and reads real
 * process.env -- it has no parameter for injecting an env source. This
 * task's public functions take env as an explicit argument instead, so the
 * stub-vs-live decision is unit-testable without mutating global
 * process.env from the test file (see tests/adapters/stubs.test.ts, which
 * calls metaAdsAdapter({...}) directly with plain objects).
 *
 * The safety property credentialGatedAdapter exists to guarantee --
 * construction never throws, and the discriminated union means a stub
 * cannot omit its reason and a live adapter cannot carry a stray one -- is
 * preserved here: every branch below returns a plain object literal typed
 * as OutcomeAdapter, so the compiler enforces the same shape, and neither
 * function does anything that can throw before returning.
 */

/**
 * Meta Marketing API is free, and Standard Access covers any ad account you
 * own as soon as the app exists. Registered here as a stub: the contract is
 * real, only the credentials are absent. See data/adapters-meta.md for the
 * access reality and the steps to enable it.
 */
export function metaAdsAdapter(env: Env): OutcomeAdapter {
  const configured = Boolean(env.META_AD_ACCOUNT_ID && env.META_ACCESS_TOKEN);

  if (!configured) {
    return {
      id: "meta-ads",
      surface: "meta_ads",
      status: "stub",
      unavailableReason:
        "Not configured. Set META_AD_ACCOUNT_ID and META_ACCESS_TOKEN. " +
        "Meta Standard Access is free and immediate for ad accounts you own. See data/adapters-meta.md.",
      fetch: async () => [],
    };
  }

  return {
    id: "meta-ads",
    surface: "meta_ads",
    status: "live",
    async fetch() {
      throw new Error("meta-ads live path not implemented in this build; see data/adapters-meta.md");
    },
  };
}

/**
 * LinkedIn's Marketing Developer Platform requires manual approval: about
 * four weeks at best, four months on average, and refusal is common and
 * unexplained. CSV export is the path that works today. See
 * data/adapters-linkedin.md for the access reality and the import command.
 */
export function linkedInAdsAdapter(env: Env): OutcomeAdapter {
  const configured = Boolean(env.LINKEDIN_ACCESS_TOKEN);

  if (!configured) {
    return {
      id: "linkedin-ads",
      surface: "linkedin_ads",
      status: "stub",
      unavailableReason:
        "Not configured. The Marketing Developer Platform needs manual approval " +
        "(about four weeks at best, four months on average). Use CSV export today: " +
        "npm run measure -- --csv path/to/linkedin-report.csv. See data/adapters-linkedin.md.",
      fetch: async () => [],
    };
  }

  return {
    id: "linkedin-ads",
    surface: "linkedin_ads",
    status: "live",
    async fetch() {
      throw new Error("linkedin-ads live path not implemented in this build; use CSV import");
    },
  };
}
