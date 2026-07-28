import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCard } from "../../src/render/cli-build.js";
import type { PageSpec } from "../../src/render/page.js";

const spec: PageSpec = {
  cardId: "cc-900",
  slug: "base1",
  headline: "Your next full-stack app",
  subhead: "Base44's first in-house model.",
  body: "Trained on real building patterns.",
  ctaLabel: "Start building",
  ctaHref: "https://base44.com",
  audienceId: "dev-accelerator",
  campaignId: "base1-launch",
};

const card = {
  id: "cc-900",
  channel: "landing_page",
  surface: "landing_page",
  topic: "font embedding",
  status: "approved",
  created: "2026-07-28",
  guardian_score: 9,
  history: [],
};

let dir: string;
let cards: string;
let out: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-build-fonts-"));
  cards = join(dir, "cards.jsonl");
  out = join(dir, "pages");
  writeFileSync(cards, `${JSON.stringify(card)}\n`);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildCard font embedding (design-guardian finding, cc-004)", () => {
  it("embeds the resolved face into the page so the headline does not silently fall back to the visitor's OS", async () => {
    const fontsDir = join(dir, "fonts");
    mkdirSync(fontsDir);
    writeFileSync(join(fontsDir, "Geist-Regular.ttf"), Buffer.from("regular-bytes"));
    writeFileSync(join(fontsDir, "Geist-Bold.ttf"), Buffer.from("bold-bytes"));

    await buildCard({ spec, cardsPath: cards, outDir: out, withImage: false, fontsDir });

    const html = readFileSync(join(out, "cc-900", "index.html"), "utf8");
    expect(html).toContain("@font-face");
    expect(html).toContain(`data:font/ttf;base64,${Buffer.from("bold-bytes").toString("base64")}`);
    expect(html).toContain(`data:font/ttf;base64,${Buffer.from("regular-bytes").toString("base64")}`);
  });

  it("puts the resolved display face first in the h1 stack", async () => {
    const fontsDir = join(dir, "fonts");
    mkdirSync(fontsDir);
    writeFileSync(join(fontsDir, "Geist-Regular.ttf"), Buffer.from("regular-bytes"));
    writeFileSync(join(fontsDir, "Geist-Bold.ttf"), Buffer.from("bold-bytes"));

    await buildCard({ spec, cardsPath: cards, outDir: out, withImage: false, fontsDir });

    // One entry, not two: with Dazzed absent the display face resolves to
    // Geist, and a repeated identical entry is inert (see the dedupe note in
    // buildStyleSheet). What matters is that the h1 names a family the page
    // actually embedded, rather than dropping to system-ui.
    const html = readFileSync(join(out, "cc-900", "index.html"), "utf8").replace(/\s+/g, " ");
    expect(html).toMatch(/h1\{font-family:"Geist",system-ui/);
  });

  it("still builds a page on a cold clone with no fonts fetched, carrying no @font-face", async () => {
    await buildCard({
      spec,
      cardsPath: cards,
      outDir: out,
      withImage: false,
      fontsDir: join(dir, "no-fonts-here"),
    });

    const html = readFileSync(join(out, "cc-900", "index.html"), "utf8");
    expect(html).not.toContain("@font-face");
    // The stack still degrades through the brand body face rather than
    // straight to the visitor's OS -- that is the part that must hold
    // whether or not any bytes were available to embed.
    expect(html.replace(/\s+/g, " ")).toMatch(/h1\{font-family:"Dazzed","Geist",/);
  });
});
