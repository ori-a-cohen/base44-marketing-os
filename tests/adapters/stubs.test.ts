import { describe, it, expect } from "vitest";
import { metaAdsAdapter, linkedInAdsAdapter } from "../../src/adapters/stubs.js";
import { COUNTING_PROVENANCES } from "../../src/cards/schema.js";

describe("ad platform stubs", () => {
  it("meta is a stub when credentials are absent", () => {
    const a = metaAdsAdapter({});
    expect(a.status).toBe("stub");
    expect(a.status === "stub" && a.unavailableReason).toContain("META_AD_ACCOUNT_ID");
  });

  it("meta reports itself live when credentials are present", () => {
    expect(metaAdsAdapter({ META_AD_ACCOUNT_ID: "act_1", META_ACCESS_TOKEN: "t" }).status).toBe("live");
  });

  it("a stub returns no outcomes rather than throwing", async () => {
    await expect(metaAdsAdapter({}).fetch(["cc-1"])).resolves.toEqual([]);
  });

  it("linkedin explains its access reality, not just missing keys", () => {
    const a = linkedInAdsAdapter({});
    expect(a.status === "stub" && a.unavailableReason).toMatch(/CSV|approval/i);
  });

  it("a stub contributes nothing to either side of the metric", async () => {
    const outcomes = await linkedInAdsAdapter({}).fetch(["cc-1", "cc-2"]);
    expect(outcomes).toHaveLength(0);
  });

  // Additions beyond the brief's verbatim tests, per the task's explicit
  // requirement to test the provenance property directly rather than rely
  // on the empty-array assertions above to imply it.
  it("meta's stub fetch never yields a counting provenance (cold-clone case, credentials absent)", async () => {
    const outcomes = await metaAdsAdapter({}).fetch(["cc-1"]);
    expect(outcomes.every((o) => !COUNTING_PROVENANCES.includes(o.provenance))).toBe(true);
  });

  it("linkedin's stub fetch never yields a counting provenance (cold-clone case, credentials absent)", async () => {
    const outcomes = await linkedInAdsAdapter({}).fetch(["cc-1"]);
    expect(outcomes.every((o) => !COUNTING_PROVENANCES.includes(o.provenance))).toBe(true);
  });
});
