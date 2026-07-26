import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCard, pageSpecFromCard, parseCliArgs, runBuildCli } from "../../src/render/cli-build.js";
import { readCards } from "../../src/cards/store.js";
import { parseCard } from "../../src/cards/schema.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-b-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const spec = {
  cardId: "cc-100",
  slug: "base1",
  headline: "Base1 builds your app",
  subhead: "First in-house model.",
  body: "Trained on real building patterns.",
  ctaLabel: "Start building",
  ctaHref: "https://base44.com",
  audienceId: "solo-builder",
  campaignId: "base1-launch",
};

describe("buildCard", () => {
  it("writes the page and records the artifact on the card", async () => {
    const cards = join(dir, "cards.jsonl");
    writeFileSync(
      cards,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
      }) + "\n",
    );

    const out = join(dir, "pages");
    await buildCard({ spec, cardsPath: cards, outDir: out, withImage: false });

    const html = join(out, "cc-100", "index.html");
    expect(existsSync(html)).toBe(true);
    expect(readFileSync(html, "utf8")).toContain("Not official Base44 content");

    const card = readCards(cards).find((c) => c.id === "cc-100");
    expect(card?.artifacts.page).toContain("cc-100");
    expect(card?.status).toBe("shipped");
    expect(card?.shipped_at).not.toBeNull();
  });

  it("fails loudly when the card does not exist", async () => {
    await expect(
      buildCard({ spec, cardsPath: join(dir, "none.jsonl"), outDir: dir, withImage: false }),
    ).rejects.toThrow(/cc-100/);
  });

  // Additions beyond the brief's verbatim two tests, per this task's
  // explicit requirement to also cover: display_font written from the
  // renderer's actual font resolution, and the cold-font path not crashing.
  it("writes attributes.display_font from the font actually used when an image is rendered (AMENDMENT A)", async () => {
    const cards = join(dir, "cards.jsonl");
    writeFileSync(
      cards,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
      }) + "\n",
    );

    // Pointed at an empty fixture dir (not the repo's real assets/fonts/) so
    // this is deterministic regardless of what an operator has downloaded --
    // this exercises the cold-font path: no Dazzed, no Geist, system fallback
    // only. It must not throw as long as a system font is present, which it
    // is on every machine this suite runs on (see card-image.test.ts).
    const coldFontsDir = join(dir, "no-fonts-here");
    const out = join(dir, "pages");
    await buildCard({ spec, cardsPath: cards, outDir: out, withImage: true, fontsDir: coldFontsDir });

    const card = readCards(cards).find((c) => c.id === "cc-100");
    expect(typeof card?.attributes.display_font).toBe("string");
    expect(card?.attributes.display_font).toMatch(/^System \(/);
    expect(existsSync(join(out, "cc-100", "card.png"))).toBe(true);
  });

  it("never writes attributes.display_font when withImage is false", async () => {
    const cards = join(dir, "cards.jsonl");
    writeFileSync(
      cards,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
      }) + "\n",
    );

    await buildCard({ spec, cardsPath: cards, outDir: join(dir, "pages"), withImage: false });
    const card = readCards(cards).find((c) => c.id === "cc-100");
    expect(card?.attributes.display_font).toBeUndefined();
  });

  /**
   * Precedence reframe. This test previously asserted the OPPOSITE -- that a
   * pre-existing `headline` attribute survived a build whose spec carried a
   * different headline. That was only correct while buildCard persisted no
   * copy at all. Now that it does, the spec must win: `attributes` describe
   * the bytes this build just wrote to disk, so a stale value left over from
   * an earlier spec would make the board display copy the page does not
   * contain. Attributes buildCard did NOT render are still preserved -- see
   * the next test.
   */
  it("lets the just-rendered spec win over a stale copy attribute", async () => {
    const cards = join(dir, "cards.jsonl");
    writeFileSync(
      cards,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
        attributes: { headline: "x", slug: "stale", subhead: "y", body: "z", ctaLabel: "Go", ctaHref: "https://x" },
      }) + "\n",
    );

    await buildCard({
      spec,
      cardsPath: cards,
      outDir: join(dir, "pages"),
      withImage: true,
      fontsDir: join(dir, "no-fonts-here"),
    });
    const card = readCards(cards).find((c) => c.id === "cc-100");
    expect(card?.attributes.headline).toBe(spec.headline);
    expect(card?.attributes.slug).toBe(spec.slug);
    expect(card?.attributes.display_font).toMatch(/^System \(/);
  });

  it("persists the page spec's copy onto card.attributes so the board can show what shipped", async () => {
    const cards = join(dir, "cards.jsonl");
    writeFileSync(
      cards,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
      }) + "\n",
    );

    await buildCard({ spec, cardsPath: cards, outDir: join(dir, "pages"), withImage: false });

    const card = readCards(cards).find((c) => c.id === "cc-100");
    expect(card?.attributes.slug).toBe(spec.slug);
    expect(card?.attributes.headline).toBe(spec.headline);
    expect(card?.attributes.subhead).toBe(spec.subhead);
    expect(card?.attributes.body).toBe(spec.body);
    expect(card?.attributes.ctaLabel).toBe(spec.ctaLabel);
    expect(card?.attributes.ctaHref).toBe(spec.ctaHref);
  });

  /**
   * audienceId/campaignId are deliberately NOT written into attributes: the
   * same upsert already sets the top-level audience_id/campaign_id, and
   * pageSpecFromCard only falls back to the attribute form when those are
   * absent. Writing both would create a second source of truth for one fact.
   */
  it("does not duplicate audience/campaign ids into attributes", async () => {
    const cards = join(dir, "cards.jsonl");
    writeFileSync(
      cards,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
      }) + "\n",
    );

    await buildCard({ spec, cardsPath: cards, outDir: join(dir, "pages"), withImage: false });

    const card = readCards(cards).find((c) => c.id === "cc-100");
    expect(card?.attributes.audienceId).toBeUndefined();
    expect(card?.attributes.campaignId).toBeUndefined();
    expect(card?.audience_id).toBe(spec.audienceId);
    expect(card?.campaign_id).toBe(spec.campaignId);
  });

  it("preserves an operator attribute it did not render", async () => {
    const cards = join(dir, "cards.jsonl");
    writeFileSync(
      cards,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
        attributes: { operator_note: "keep me" },
      }) + "\n",
    );

    await buildCard({ spec, cardsPath: cards, outDir: join(dir, "pages"), withImage: false });

    const card = readCards(cards).find((c) => c.id === "cc-100");
    expect(card?.attributes.operator_note).toBe("keep me");
    expect(card?.attributes.headline).toBe(spec.headline);
  });

  /**
   * The round trip that makes `cli-build --card <id>` work on a card this
   * same function built: buildCard writes exactly the six keys
   * pageSpecFromCard reads back, and audienceId/campaignId come from the
   * top-level fields the same upsert set. Before this, a card built through
   * scripts/demo.sh could not be rebuilt from itself -- requireAttr threw on
   * the missing `slug`.
   */
  it("round-trips: pageSpecFromCard reproduces the spec that built the card", async () => {
    const cards = join(dir, "cards.jsonl");
    writeFileSync(
      cards,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
      }) + "\n",
    );

    await buildCard({ spec, cardsPath: cards, outDir: join(dir, "pages"), withImage: false });

    const card = readCards(cards).find((c) => c.id === "cc-100");
    expect(card).toBeDefined();
    expect(pageSpecFromCard(card as NonNullable<typeof card>)).toEqual(spec);
  });
});

describe("pageSpecFromCard", () => {
  const attrs = {
    slug: "base1",
    headline: "Base1 builds your app",
    subhead: "First in-house model.",
    body: "Trained on real building patterns.",
    ctaLabel: "Start building",
    ctaHref: "https://base44.com",
  };

  it("builds a PageSpec from a card's attributes and top-level audience/campaign ids", () => {
    const card = parseCard({
      id: "cc-100",
      channel: "landing_page",
      topic: "Base1",
      status: "approved",
      created: "2026-07-23",
      audience_id: "solo-builder",
      campaign_id: "base1-launch",
      attributes: attrs,
    });
    expect(pageSpecFromCard(card)).toEqual({
      cardId: "cc-100",
      audienceId: "solo-builder",
      campaignId: "base1-launch",
      ...attrs,
    });
  });

  it("falls back to attributes.audienceId/campaignId when the top-level fields are absent", () => {
    const card = parseCard({
      id: "cc-100",
      channel: "landing_page",
      topic: "Base1",
      status: "approved",
      created: "2026-07-23",
      attributes: { ...attrs, audienceId: "solo-builder", campaignId: "base1-launch" },
    });
    const built = pageSpecFromCard(card);
    expect(built.audienceId).toBe("solo-builder");
    expect(built.campaignId).toBe("base1-launch");
  });

  it("throws a clear error naming the missing attribute, never fabricating one", () => {
    const card = parseCard({
      id: "cc-100",
      channel: "landing_page",
      topic: "Base1",
      status: "approved",
      created: "2026-07-23",
      audience_id: "solo-builder",
      campaign_id: "base1-launch",
      attributes: { slug: "base1" },
    });
    expect(() => pageSpecFromCard(card)).toThrow(/headline/);
  });

  it("throws a clear error naming the card when audience_id is missing everywhere", () => {
    const card = parseCard({
      id: "cc-100",
      channel: "landing_page",
      topic: "Base1",
      status: "approved",
      created: "2026-07-23",
      attributes: attrs,
    });
    expect(() => pageSpecFromCard(card)).toThrow(/cc-100/);
    expect(() => pageSpecFromCard(card)).toThrow(/audience/i);
  });
});

describe("parseCliArgs", () => {
  it("reads --card <cardId>", () => {
    expect(parseCliArgs(["--card", "cc-100"])).toEqual({ cardId: "cc-100" });
  });

  it("throws a usage error when --card is missing", () => {
    expect(() => parseCliArgs([])).toThrow(/--card/);
  });

  it("throws a usage error when --card has no value", () => {
    expect(() => parseCliArgs(["--card"])).toThrow(/--card/);
  });
});

describe("runBuildCli (Task 19's fixed --card interface)", () => {
  it("builds the named card end to end given only a card id, reading the spec off the card's own attributes", async () => {
    const cardsPath = join(dir, "cards.jsonl");
    writeFileSync(
      cardsPath,
      JSON.stringify({
        id: "cc-100",
        channel: "landing_page",
        topic: "Base1",
        status: "approved",
        created: "2026-07-23",
        audience_id: "solo-builder",
        campaign_id: "base1-launch",
        attributes: {
          slug: "base1",
          headline: "Base1 builds your app",
          subhead: "First in-house model.",
          body: "Trained on real building patterns.",
          ctaLabel: "Start building",
          ctaHref: "https://base44.com",
        },
      }) + "\n",
    );
    const outDir = join(dir, "pages");

    await runBuildCli(["--card", "cc-100"], {
      cardsPath,
      outDir,
      fontsDir: join(dir, "no-fonts-here"),
    });

    expect(existsSync(join(outDir, "cc-100", "index.html"))).toBe(true);
    const card = readCards(cardsPath).find((c) => c.id === "cc-100");
    expect(card?.status).toBe("shipped");
    expect(card?.attributes.display_font).toMatch(/^System \(/);
  });

  it("errors clearly (never creating a card) when the card id does not exist in the store", async () => {
    const cardsPath = join(dir, "cards.jsonl");
    writeFileSync(cardsPath, "");
    await expect(
      runBuildCli(["--card", "cc-missing"], { cardsPath, outDir: join(dir, "pages") }),
    ).rejects.toThrow(/cc-missing/);
    expect(readCards(cardsPath)).toHaveLength(0);
  });
});
