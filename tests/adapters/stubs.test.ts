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

  // Task 11 fix: both stubs now route through credentialGatedAdapter, which
  // must remain safe against any caller-supplied env source, including the
  // complete absence of one.
  describe("hardened env handling (post-fix)", () => {
    it("metaAdsAdapter(undefined) returns a stub and does not throw", () => {
      expect(() => metaAdsAdapter(undefined)).not.toThrow();
      const adapter = metaAdsAdapter(undefined);
      expect(adapter.status).toBe("stub");
    });

    it("linkedInAdsAdapter(undefined) returns a stub and does not throw", () => {
      expect(() => linkedInAdsAdapter(undefined)).not.toThrow();
      const adapter = linkedInAdsAdapter(undefined);
      expect(adapter.status).toBe("stub");
    });

    it("metaAdsAdapter with a throwing getter on a required key returns a stub, does not throw", () => {
      const hostileEnv = {
        get META_AD_ACCOUNT_ID(): string {
          throw new Error("getter boom");
        },
        META_ACCESS_TOKEN: "t",
      };
      expect(() => metaAdsAdapter(hostileEnv)).not.toThrow();
      const adapter = metaAdsAdapter(hostileEnv);
      expect(adapter.status).toBe("stub");
    });

    it("linkedInAdsAdapter with a throwing getter on its required key returns a stub, does not throw", () => {
      const hostileEnv = {
        get LINKEDIN_ACCESS_TOKEN(): string {
          throw new Error("getter boom");
        },
      };
      expect(() => linkedInAdsAdapter(hostileEnv)).not.toThrow();
      const adapter = linkedInAdsAdapter(hostileEnv);
      expect(adapter.status).toBe("stub");
    });

    it("meta: empty object names both missing variables", () => {
      const a = metaAdsAdapter({});
      expect(a.status === "stub" && a.unavailableReason).toContain("META_AD_ACCOUNT_ID");
      expect(a.status === "stub" && a.unavailableReason).toContain("META_ACCESS_TOKEN");
    });

    it("meta: only META_AD_ACCOUNT_ID set still names the missing META_ACCESS_TOKEN", () => {
      const a = metaAdsAdapter({ META_AD_ACCOUNT_ID: "act_1" });
      expect(a.status).toBe("stub");
      expect(a.status === "stub" && a.unavailableReason).toContain("META_ACCESS_TOKEN");
    });

    it("meta: only META_ACCESS_TOKEN set still names the missing META_AD_ACCOUNT_ID", () => {
      const a = metaAdsAdapter({ META_ACCESS_TOKEN: "t" });
      expect(a.status).toBe("stub");
      expect(a.status === "stub" && a.unavailableReason).toContain("META_AD_ACCOUNT_ID");
    });

    it("meta: fully populated env is live", () => {
      const a = metaAdsAdapter({ META_AD_ACCOUNT_ID: "act_1", META_ACCESS_TOKEN: "t" });
      expect(a.status).toBe("live");
    });

    it("linkedin: empty object names the missing variable", () => {
      const a = linkedInAdsAdapter({});
      expect(a.status === "stub" && a.unavailableReason).toContain("LINKEDIN_ACCESS_TOKEN");
    });

    it("linkedin: fully populated env is live", () => {
      const a = linkedInAdsAdapter({ LINKEDIN_ACCESS_TOKEN: "t" });
      expect(a.status).toBe("live");
    });

    it("meta live fetch still rejects loudly with its not-implemented message", async () => {
      const a = metaAdsAdapter({ META_AD_ACCOUNT_ID: "act_1", META_ACCESS_TOKEN: "t" });
      await expect(a.fetch(["cc-1"])).rejects.toThrow(/not implemented/i);
    });

    it("linkedin live fetch still rejects loudly with its not-implemented message", async () => {
      const a = linkedInAdsAdapter({ LINKEDIN_ACCESS_TOKEN: "t" });
      await expect(a.fetch(["cc-1"])).rejects.toThrow(/not implemented/i);
    });
  });
});
