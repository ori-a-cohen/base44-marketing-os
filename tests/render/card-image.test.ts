import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTokens, findOffTokenValues } from "../../src/lint/tokens.js";
import { renderCardSvg, renderCardPng, resolveFonts } from "../../src/render/card-image.js";
import { MARKER_TEXT } from "../../src/render/page.js";

const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));
const spec = { headline: "Base1 builds your app", kicker: "Base44", cardId: "cc-100" };

// A cold checkout: assets/fonts/ is gitignored, so a fresh clone has nothing
// in it -- these tests must pass in exactly that state (no network, no
// downloaded fonts) and are pointed at a fixture directory rather than the
// repo's real assets/fonts/ so they are deterministic regardless of what an
// operator may have dropped in locally.
let coldDir: string;
beforeEach(() => {
  coldDir = mkdtempSync(join(tmpdir(), "rt-fonts-cold-"));
});
afterEach(() => {
  rmSync(coldDir, { recursive: true, force: true });
});

describe("renderCardSvg", () => {
  it("produces an SVG at social card dimensions", async () => {
    const { svg } = await renderCardSvg(spec, tokens, coldDir);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
  });

  it("uses only token colours", async () => {
    const { svg } = await renderCardSvg(spec, tokens, coldDir);
    expect(findOffTokenValues(svg, tokens)).toEqual([]);
  });

  it("includes the marker text", async () => {
    const { svg } = await renderCardSvg(spec, tokens, coldDir);
    expect(svg).toContain("Not official");
    expect(svg).toContain(MARKER_TEXT.slice(0, 20));
  });

  it("renders the headline", async () => {
    const { svg } = await renderCardSvg(spec, tokens, coldDir);
    expect(svg).toContain("Base1");
  });

  it("cold-runs with no assets/fonts/ directory at all: no throw, and reports a system fallback", async () => {
    const missingDir = join(coldDir, "does-not-exist");
    const { svg, fontUsed } = await renderCardSvg(spec, tokens, missingDir);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(fontUsed.display.startsWith("System")).toBe(true);
    expect(fontUsed.body.startsWith("System")).toBe(true);
  });
});

describe("renderCardPng", () => {
  it("produces a PNG buffer starting with the PNG magic bytes", async () => {
    const { png, fontUsed } = await renderCardPng(spec, tokens, coldDir);
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(fontUsed.display.length).toBeGreaterThan(0);
    expect(fontUsed.body.length).toBeGreaterThan(0);
  });
});

describe("resolveFonts: cold-run guarantee (no network, no downloaded fonts)", () => {
  it("falls back to a system font for both faces when assets/fonts/ is empty", () => {
    const { fontUsed, fonts } = resolveFonts(coldDir);
    expect(fontUsed.display).toMatch(/^System \(/);
    expect(fontUsed.body).toMatch(/^System \(/);
    expect(fonts).toHaveLength(2);
    for (const font of fonts) {
      expect(font.data.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a system font for both faces when assets/fonts/ does not exist", () => {
    const missingDir = join(coldDir, "does-not-exist");
    const { fontUsed } = resolveFonts(missingDir);
    expect(fontUsed.display).toMatch(/^System \(/);
    expect(fontUsed.body).toMatch(/^System \(/);
  });

  it("throws a clear, actionable error naming scripts/fetch-fonts.sh when truly no font is available anywhere", () => {
    expect(() => resolveFonts(coldDir, [])).toThrow(/scripts\/fetch-fonts\.sh/);
  });
});

describe("resolveFonts: the Dazzed -> Geist -> system resolution order (Amendment A)", () => {
  it("prefers Geist over system when only a Geist file is present (the honest fallback case)", () => {
    writeFileSync(join(coldDir, "Geist-Regular.ttf"), "fake-geist-bytes");
    const { fontUsed } = resolveFonts(coldDir);
    expect(fontUsed.display).toBe("Geist");
    expect(fontUsed.body).toBe("Geist");
  });

  it("prefers Dazzed over Geist for the display face when both are present", () => {
    writeFileSync(join(coldDir, "Dazzed-Regular.ttf"), "fake-dazzed-bytes");
    writeFileSync(join(coldDir, "Geist-Regular.ttf"), "fake-geist-bytes");
    const { fontUsed } = resolveFonts(coldDir);
    expect(fontUsed.display).toBe("Dazzed");
    // Dazzed is display-only per DESIGN.md: body always resolves Geist, never Dazzed.
    expect(fontUsed.body).toBe("Geist");
  });

  it("never picks Dazzed for the body face even when only Dazzed is present", () => {
    writeFileSync(join(coldDir, "Dazzed-Regular.ttf"), "fake-dazzed-bytes");
    const { fontUsed } = resolveFonts(coldDir);
    expect(fontUsed.display).toBe("Dazzed");
    expect(fontUsed.body).toMatch(/^System \(/);
  });

  it("reads the actual bytes of the resolved asset font file, not the system fallback", () => {
    writeFileSync(join(coldDir, "Geist-Regular.ttf"), "fake-geist-bytes");
    const { fonts } = resolveFonts(coldDir);
    const display = fonts.find((f) => f.name === "display");
    expect(display?.data.toString("utf8")).toBe("fake-geist-bytes");
  });

  it("prefers a -Regular file when multiple weights of the same face are present", () => {
    writeFileSync(join(coldDir, "Geist-Bold.ttf"), "fake-geist-bold");
    writeFileSync(join(coldDir, "Geist-Regular.ttf"), "fake-geist-regular");
    const { fonts } = resolveFonts(coldDir);
    const body = fonts.find((f) => f.name === "body");
    expect(body?.data.toString("utf8")).toBe("fake-geist-regular");
  });
});
