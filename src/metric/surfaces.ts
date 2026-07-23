const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type SurfaceStatus = "live" | "stub" | "unknown";

export interface SurfaceSpec {
  readonly id: string;
  readonly label: string;
  readonly status: SurfaceStatus;
  /** Grace period after shipping before the card enters the denominator. */
  readonly tMatureMs: number;
  /** How long a measurement stays fresh before it must be retaken. */
  readonly ttlMs: number;
  readonly primaryMetric: string;
  /** "Par" for this surface. normalizeScore maps benchmark to 50. */
  readonly benchmark: number;
}

export const SURFACES: Readonly<Record<string, SurfaceSpec>> = {
  landing_page: {
    id: "landing_page", label: "Landing page", status: "live",
    tMatureMs: 15 * MINUTE, ttlMs: 7 * DAY, primaryMetric: "visits", benchmark: 20,
  },
  aeo_check: {
    id: "aeo_check", label: "Answer engines", status: "live",
    tMatureMs: 1 * HOUR, ttlMs: 14 * DAY, primaryMetric: "canon_match", benchmark: 50,
  },
  meta_ads: {
    id: "meta_ads", label: "Meta ads", status: "stub",
    tMatureMs: 1 * DAY, ttlMs: 7 * DAY, primaryMetric: "cost_per_signup", benchmark: 25,
  },
  linkedin_ads: {
    id: "linkedin_ads", label: "LinkedIn ads", status: "stub",
    tMatureMs: 1 * DAY, ttlMs: 7 * DAY, primaryMetric: "cost_per_signup", benchmark: 40,
  },
};

const DEFAULT_SURFACE = (id: string): SurfaceSpec => ({
  id, label: id, status: "unknown",
  tMatureMs: 1 * HOUR, ttlMs: 7 * DAY, primaryMetric: "value", benchmark: 10,
});

export function getSurface(id: string): SurfaceSpec {
  return SURFACES[id] ?? DEFAULT_SURFACE(id);
}

/**
 * Maps a raw value to 0-100 against the surface's own benchmark, where
 * benchmark == 50. Surfaces are never compared on raw values.
 */
export function normalizeScore(surfaceId: string, value: number): number {
  const { benchmark } = getSurface(surfaceId);
  if (value <= 0) return 0;
  const ratio = value / benchmark;
  const score = ratio <= 1 ? ratio * 50 : 50 + Math.min(50, (Math.log10(ratio) / 2) * 50);
  return Math.max(0, Math.min(100, Math.round(score)));
}
