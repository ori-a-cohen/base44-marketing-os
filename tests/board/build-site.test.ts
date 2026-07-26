import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setBoardEndpoint, buildSite } from "../../src/board/build-site.js";
import { parseTokens } from "../../src/lint/tokens.js";
import { parseCard, type Card } from "../../src/cards/schema.js";

let dir: string;
let uiPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-site-"));
  uiPath = join(dir, "ui.html");
  writeFileSync(uiPath, UI, "utf8");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const UI = [
  "<!doctype html>",
  '<meta name="board-endpoint" content="/api/board">',
  '<meta name="board-preview" content="on">',
  '<iframe class="preview" sandbox=""></iframe>',
  "<main>board</main>",
].join("\n");

const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));

const COPY = {
  slug: "base1-launch",
  headline: "Ship your idea today",
  subhead: "No engineers, no setup.",
  body: "Base1 turns a prompt into a live app.",
  ctaLabel: "Start building",
  ctaHref: "https://base44.com",
};

function card(overrides: Record<string, unknown> = {}): Card {
  return parseCard({
    id: "cc-demo", channel: "landing_page", surface: "landing_page", topic: "Base1 launch",
    status: "measured", created: "2026-07-23", shipped_at: "2026-07-25T00:00:00Z",
    audience_id: "solo-builder", campaign_id: "base1-launch",
    attributes: COPY,
    artifacts: { page_slug: "base1-launch" },
    ...overrides,
  });
}

function build(cards: readonly Card[], outDir = join(dir, "dist")) {
  return buildSite({ uiPath, cards, tokens, outDir, endpoint: "/functions/board" });
}

describe("setBoardEndpoint", () => {
  it("rewrites the declared endpoint", () => {
    expect(setBoardEndpoint(UI, "/functions/board")).toContain(
      '<meta name="board-endpoint" content="/functions/board">',
    );
  });

  it("leaves the rest of the document byte-identical", () => {
    const out = setBoardEndpoint(UI, "/functions/board");
    expect(out.replace('content="/functions/board"', 'content="/api/board"')).toBe(UI);
  });

  /**
   * The failure that would matter: emitting a site whose board silently
   * points at the wrong host. If the tag this function exists to rewrite is
   * not there, that is a broken build, not a no-op to shrug past.
   */
  it("throws rather than emitting a site pointing at the wrong endpoint", () => {
    expect(() => setBoardEndpoint("<!doctype html><main>no tag</main>", "/functions/board")).toThrow(
      /board-endpoint/,
    );
  });

  it("refuses an endpoint that could break out of the attribute", () => {
    expect(() => setBoardEndpoint(UI, 'https://x/"><script>')).toThrow(/endpoint/i);
  });
});

describe("board-preview capability", () => {
  /**
   * Base44 hosting sends X-Frame-Options: DENY on every response, so a
   * preview iframe there is refused and renders as a broken-image box. The
   * board cannot detect that before trying, so the build declares it.
   */
  it("defaults to off, because this only ever builds for a remote host", () => {
    const out = build([card()]);
    const index = readFileSync(out.indexPath, "utf8");
    expect(index).toContain('<meta name="board-preview" content="off">');
  });

  it("can be turned on for a host that permits framing", () => {
    const outDir = join(dir, "dist-on");
    buildSite({ uiPath, cards: [card()], tokens, outDir, endpoint: "/functions/board", preview: "on" });
    expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain(
      '<meta name="board-preview" content="on">',
    );
  });

  it("throws if the board stops declaring the capability at all", () => {
    const noTag = join(dir, "no-preview.html");
    writeFileSync(noTag, '<!doctype html><meta name="board-endpoint" content="/api/board">', "utf8");
    expect(() =>
      buildSite({ uiPath: noTag, cards: [], tokens, outDir: join(dir, "d"), endpoint: "/functions/board" }),
    ).toThrow(/board-preview/);
  });
});

describe("buildSite", () => {
  it("writes the board as index.html with the endpoint rewritten", () => {
    const outDir = join(dir, "dist");
    const report = build([card()], outDir);

    const index = readFileSync(join(outDir, "index.html"), "utf8");
    expect(index).toContain('content="/functions/board"');
    expect(index).toContain("<main>board</main>");
    expect(report.indexPath).toBe(join(outDir, "index.html"));
  });

  /**
   * Without this the hosted preview iframe loads the SPA catch-all instead of
   * the page and -- being sandboxed, so unable to run scripts -- renders
   * blank. The board would look broken while claiming to show what shipped.
   */
  it("deploys each card's page at the same route the board links to", () => {
    const outDir = join(dir, "dist");
    const report = build([card()], outDir);

    const deployed = join(outDir, "c", "cc-demo", "base1-launch", "index.html");
    expect(existsSync(deployed)).toBe(true);
    expect(report.pages).toEqual(["/c/cc-demo/base1-launch"]);
  });

  /**
   * The bug this test exists for: the site was first built from the local
   * card store while the deployed board reads the hosted one. Local slug was
   * "base1", hosted was "base1-launch", so every preview 404'd. The page must
   * be derived from the card the board will actually show.
   */
  it("derives the page from the card's own copy, so route and content always match the board", () => {
    const outDir = join(dir, "dist");
    build([card()], outDir);

    const html = readFileSync(join(outDir, "c", "cc-demo", "base1-launch", "index.html"), "utf8");
    expect(html).toContain("Ship your idea today");
    expect(html).toContain("No engineers, no setup.");
    expect(html).toContain("Not official Base44 content");
    expect(html).toContain("utm_content=cc-demo");
  });

  it("reports a card whose page cannot be derived, rather than inventing one", () => {
    const outDir = join(dir, "dist");
    const incomplete = card({ attributes: { slug: "base1-launch" } });
    const report = build([incomplete], outDir);

    expect(report.pages).toEqual([]);
    expect(report.unbuildable).toHaveLength(1);
    expect(report.unbuildable[0]?.id).toBe("cc-demo");
    expect(report.unbuildable[0]?.reason).toMatch(/headline/);
    expect(existsSync(join(outDir, "c", "cc-demo"))).toBe(false);
  });

  it("skips a card with no page artifact at all without reporting it as a problem", () => {
    const offPlatform = parseCard({
      id: "cc-001", channel: "linkedin", topic: "post", status: "shipped", created: "2026-07-01",
    });
    const report = build([offPlatform]);
    expect(report.pages).toEqual([]);
    expect(report.unbuildable).toEqual([]);
  });

  it("deploys only the current version of a regenerated card", () => {
    const outDir = join(dir, "dist");
    const v1 = card({ version: 1, artifacts: { page_slug: "old" }, attributes: { ...COPY, slug: "old" } });
    const v2 = card({ version: 2 });
    const report = build([v1, v2], outDir);

    expect(report.pages).toEqual(["/c/cc-demo/base1-launch"]);
    expect(existsSync(join(outDir, "c", "cc-demo", "old"))).toBe(false);
  });

  it("starts from a clean output directory so a removed card cannot linger", () => {
    const outDir = join(dir, "dist");
    mkdirSync(join(outDir, "c", "cc-gone", "slug"), { recursive: true });
    writeFileSync(join(outDir, "c", "cc-gone", "slug", "index.html"), "stale", "utf8");

    build([card()], outDir);

    expect(existsSync(join(outDir, "c", "cc-gone"))).toBe(false);
  });

  it("refuses a slug that would escape the output directory", () => {
    const outDir = join(dir, "dist");
    const evil = card({ artifacts: { page_slug: "../../escaped" } });
    const report = build([evil], outDir);

    expect(report.pages).toEqual([]);
    expect(report.unbuildable[0]?.reason).toMatch(/unsafe page_slug/);
    expect(existsSync(join(dir, "escaped"))).toBe(false);
  });
});
