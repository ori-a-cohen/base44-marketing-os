import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cold clone acceptance", () => {
  it("runs the whole loop with zero API keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-cold-"));
    try {
      const env = {
        ...process.env,
        CARDS_PATH: join(dir, "cards.jsonl"),
        VISITS_PATH: join(dir, "visits.jsonl"),
        // Every optional key this project ever reads, scrubbed to prove the
        // loop closes on their absence rather than passing only because the
        // developer's own machine happens to have them set.
        UMAMI_API_KEY: "",
        META_ACCESS_TOKEN: "",
        META_AD_ACCOUNT_ID: "",
        LINKEDIN_ACCESS_TOKEN: "",
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
        BOARD_INGEST_TOKEN: "",
      };

      const out = execFileSync("bash", ["scripts/demo.sh"], { encoding: "utf8", env });

      // The card exists and carries both an artifact and a shipped timestamp.
      const cards = readFileSync(env.CARDS_PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const card = cards.find((c: { id: string }) => c.id === "cc-demo");
      expect(card.status).toBe("measured");
      expect(card.shipped_at).toBeTruthy();
      expect(card.artifacts.page).toContain("cc-demo");

      // The page was generated and carries the marker and tracking.
      const html = readFileSync("build/pages/cc-demo/index.html", "utf8");
      expect(html).toContain("Not official Base44 content");
      expect(html).toContain("utm_content=cc-demo");

      // Verification passed and the metric computed and printed as a fraction.
      expect(out).toContain("PASS");
      expect(out).toMatch(/Loop-closure rate: \d+ of \d+ measured/);

      // Stubs announced themselves rather than failing silently.
      expect(out).toContain("SKIP meta-ads");
      expect(out).toContain("SKIP linkedin-ads");

      // The board came up, served both routes, and the demo reported success.
      expect(out).toContain("GET /            -> OK");
      expect(out).toContain("GET /api/board   -> OK");
      expect(out).toContain("Done. The loop closed with zero API keys.");
      expect(existsSync(join(dir, "cards.jsonl"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync("build/pages/cc-demo", { recursive: true, force: true });
    }
  }, 180_000);
});
