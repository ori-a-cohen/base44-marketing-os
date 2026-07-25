import { describe, it, expect } from "vitest";
import { getSurface, normalizeScore, SURFACES } from "../../src/metric/surfaces.js";

describe("surface registry", () => {
  it("defines the landing page as a live surface with a short maturation window", () => {
    const s = getSurface("landing_page");
    expect(s.status).toBe("live");
    expect(s.tMatureMs).toBeGreaterThan(0);
  });

  it("marks meta and linkedin as stubs", () => {
    expect(getSurface("meta_ads").status).toBe("stub");
    expect(getSurface("linkedin_ads").status).toBe("stub");
  });

  it("falls back to a permissive default for an unknown surface", () => {
    const s = getSurface("something_new");
    expect(s.id).toBe("something_new");
    expect(s.status).toBe("unknown");
  });

  it("normalizes a value against the surface benchmark, clamped to 0-100", () => {
    const s = getSurface("landing_page");
    expect(normalizeScore("landing_page", 0)).toBe(0);
    expect(normalizeScore("landing_page", s.benchmark)).toBe(50);
    expect(normalizeScore("landing_page", s.benchmark * 100)).toBe(100);
  });

  it("every registered surface declares a primary metric and a benchmark above zero", () => {
    for (const s of Object.values(SURFACES)) {
      expect(s.primaryMetric.length).toBeGreaterThan(0);
      expect(s.benchmark).toBeGreaterThan(0);
    }
  });
});
