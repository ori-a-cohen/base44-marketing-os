import { credentialGatedAdapter, type EnvSource, type OutcomeAdapter } from "./types.js";

/**
 * Both adapters below route through `credentialGatedAdapter`
 * (src/adapters/types.ts, Task 10). That helper now accepts an injectable
 * `envSource` (defaulting to real `process.env`), so it can both guarantee
 * "construction never throws" and stay unit-testable with plain objects
 * (see tests/adapters/stubs.test.ts, which calls `metaAdsAdapter({...})`
 * directly, including `undefined` and hostile-getter objects).
 *
 * The safety property credentialGatedAdapter exists to guarantee --
 * construction never throws, and the discriminated union means a stub
 * cannot omit its reason and a live adapter cannot carry a stray one -- is
 * preserved here because the helper, not this file, decides stub vs. live
 * and reads the env source defensively. This file only enriches the
 * generic "missing environment variable(s)" reason with platform-specific
 * guidance once the helper has already produced a safe result.
 */

/** Appends platform-specific guidance to the helper's dynamic missing-variable reason. */
function withGuidance(adapter: OutcomeAdapter, guidance: string): OutcomeAdapter {
  if (adapter.status === "live") {
    return adapter;
  }
  return { ...adapter, unavailableReason: `${adapter.unavailableReason}. ${guidance}` };
}

/**
 * Meta Marketing API is free, and Standard Access covers any ad account you
 * own as soon as the app exists. Registered here as a stub: the contract is
 * real, only the credentials are absent. See data/adapters-meta.md for the
 * access reality and the steps to enable it.
 */
export function metaAdsAdapter(env?: EnvSource): OutcomeAdapter {
  const adapter = credentialGatedAdapter({
    id: "meta-ads",
    surface: "meta_ads",
    requiredEnv: ["META_AD_ACCOUNT_ID", "META_ACCESS_TOKEN"],
    envSource: env,
    build: () => ({
      async fetch() {
        throw new Error("meta-ads live path not implemented in this build; see data/adapters-meta.md");
      },
    }),
  });

  return withGuidance(
    adapter,
    "Meta Standard Access is free and immediate for ad accounts you own. See data/adapters-meta.md",
  );
}

/**
 * LinkedIn's Marketing Developer Platform requires manual approval: about
 * four weeks at best, four months on average, and refusal is common and
 * unexplained. CSV export is the path that works today. See
 * data/adapters-linkedin.md for the access reality and the import command.
 */
export function linkedInAdsAdapter(env?: EnvSource): OutcomeAdapter {
  const adapter = credentialGatedAdapter({
    id: "linkedin-ads",
    surface: "linkedin_ads",
    requiredEnv: ["LINKEDIN_ACCESS_TOKEN"],
    envSource: env,
    build: () => ({
      async fetch() {
        throw new Error("linkedin-ads live path not implemented in this build; use CSV import");
      },
    }),
  });

  return withGuidance(
    adapter,
    "The Marketing Developer Platform needs manual approval (about four weeks at best, four months on average). " +
      "Use CSV export today: npm run measure -- --csv path/to/linkedin-report.csv. See data/adapters-linkedin.md",
  );
}
