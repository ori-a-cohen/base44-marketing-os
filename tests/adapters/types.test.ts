import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { credentialGatedAdapter } from "../../src/adapters/types.js";

const ENV_KEY = "ROUNDTRIP_TEST_API_KEY";
let originalValue: string | undefined;

beforeEach(() => {
  originalValue = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalValue;
  }
});

describe("credentialGatedAdapter", () => {
  it("returns a labelled stub naming the missing variable when env is absent, and never throws", () => {
    const adapter = credentialGatedAdapter({
      id: "test-adapter",
      surface: "test_surface",
      requiredEnv: [ENV_KEY],
      build: () => ({ fetch: async () => [] }),
    });

    expect(adapter.status).toBe("stub");
    if (adapter.status === "stub") {
      expect(adapter.unavailableReason).toContain(ENV_KEY);
    }
  });

  it("does not call build when required env vars are missing", () => {
    let called = false;
    credentialGatedAdapter({
      id: "test-adapter",
      surface: "test_surface",
      requiredEnv: [ENV_KEY],
      build: () => {
        called = true;
        return { fetch: async () => [] };
      },
    });
    expect(called).toBe(false);
  });

  it("returns the live adapter when required env vars are present", async () => {
    process.env[ENV_KEY] = "secret-value";
    const adapter = credentialGatedAdapter({
      id: "test-adapter",
      surface: "test_surface",
      requiredEnv: [ENV_KEY],
      build: (env) => ({
        fetch: async (cardIds) =>
          cardIds.map((card_id) => ({
            card_id,
            surface: "test_surface",
            metric: "visits",
            value: env[ENV_KEY] === "secret-value" ? 1 : 0,
            unit: "count",
            measured_at: new Date().toISOString(),
            source: "test-adapter",
            provenance: "real" as const,
          })),
      }),
    });

    expect(adapter.status).toBe("live");
    const outcomes = await adapter.fetch(["cc-1"]);
    expect(outcomes[0]?.value).toBe(1);
  });

  it("degrades to a stub explaining the failure when the builder itself throws, without propagating", () => {
    process.env[ENV_KEY] = "secret-value";
    expect(() =>
      credentialGatedAdapter({
        id: "test-adapter",
        surface: "test_surface",
        requiredEnv: [ENV_KEY],
        build: () => {
          throw new Error("client misconfigured");
        },
      }),
    ).not.toThrow();

    const adapter = credentialGatedAdapter({
      id: "test-adapter",
      surface: "test_surface",
      requiredEnv: [ENV_KEY],
      build: () => {
        throw new Error("client misconfigured");
      },
    });
    expect(adapter.status).toBe("stub");
    if (adapter.status === "stub") {
      expect(adapter.unavailableReason).toContain("client misconfigured");
    }
  });
});
