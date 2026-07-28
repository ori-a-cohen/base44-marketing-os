import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWebFonts } from "../../src/render/web-fonts.js";

/**
 * The bytes never have to be a parseable font here: resolveWebFonts only
 * reads and base64-encodes them. Font *parsing* is satori's job in
 * card-image.ts and is covered by that module's own tests.
 */
const FAKE_TTF = Buffer.from("fake-ttf-bytes");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "web-fonts-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveWebFonts", () => {
  it("returns nothing to embed when assets/fonts is absent", () => {
    const fonts = resolveWebFonts(join(dir, "does-not-exist"));
    expect(fonts.display).toBeUndefined();
    expect(fonts.body).toBeUndefined();
  });

  it("returns nothing to embed when the directory exists but holds no ttf", () => {
    writeFileSync(join(dir, "README.md"), "no fonts here");
    const fonts = resolveWebFonts(dir);
    expect(fonts.display).toBeUndefined();
    expect(fonts.body).toBeUndefined();
  });

  it("resolves both faces to Geist when only Geist is present", () => {
    writeFileSync(join(dir, "Geist-Regular.ttf"), FAKE_TTF);
    writeFileSync(join(dir, "Geist-Bold.ttf"), FAKE_TTF);
    const fonts = resolveWebFonts(dir);
    expect(fonts.display?.family).toBe("Geist");
    expect(fonts.body?.family).toBe("Geist");
  });

  it("prefers Dazzed for the display face when it is present", () => {
    writeFileSync(join(dir, "Geist-Regular.ttf"), FAKE_TTF);
    writeFileSync(join(dir, "Dazzed-Bold.ttf"), FAKE_TTF);
    const fonts = resolveWebFonts(dir);
    expect(fonts.display?.family).toBe("Dazzed");
    expect(fonts.body?.family).toBe("Geist");
  });

  it("never consults Dazzed for the body face (display-only per DESIGN.md)", () => {
    writeFileSync(join(dir, "Dazzed-Bold.ttf"), FAKE_TTF);
    const fonts = resolveWebFonts(dir);
    expect(fonts.display?.family).toBe("Dazzed");
    expect(fonts.body).toBeUndefined();
  });

  it("prefers a Bold file for display and a Regular file for body", () => {
    writeFileSync(join(dir, "Geist-Regular.ttf"), Buffer.from("regular"));
    writeFileSync(join(dir, "Geist-Bold.ttf"), Buffer.from("bold"));
    const fonts = resolveWebFonts(dir);
    expect(fonts.display?.base64).toBe(Buffer.from("bold").toString("base64"));
    expect(fonts.body?.base64).toBe(Buffer.from("regular").toString("base64"));
  });

  it("carries the weight each face is declared at", () => {
    writeFileSync(join(dir, "Geist-Regular.ttf"), FAKE_TTF);
    writeFileSync(join(dir, "Geist-Bold.ttf"), FAKE_TTF);
    const fonts = resolveWebFonts(dir);
    expect(fonts.display?.weight).toBe(700);
    expect(fonts.body?.weight).toBe(400);
  });

  it("base64-encodes the real file bytes", () => {
    writeFileSync(join(dir, "Geist-Regular.ttf"), FAKE_TTF);
    const fonts = resolveWebFonts(dir);
    expect(fonts.body?.base64).toBe(FAKE_TTF.toString("base64"));
  });

  it("carries the licence notice from OFL.txt when a face is embedded", () => {
    writeFileSync(join(dir, "Geist-Regular.ttf"), FAKE_TTF);
    writeFileSync(
      join(dir, "OFL.txt"),
      "Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)\n\n" +
        "This Font Software is licensed under the SIL Open Font License, Version 1.1.\n",
    );
    const fonts = resolveWebFonts(dir);
    expect(fonts.notice).toContain("Copyright 2024 The Geist Project Authors");
    expect(fonts.notice).toContain("SIL Open Font License, Version 1.1");
  });

  it("reads the notice from the file rather than hardcoding it", () => {
    writeFileSync(join(dir, "Geist-Regular.ttf"), FAKE_TTF);
    writeFileSync(join(dir, "OFL.txt"), "Copyright 1999 Somebody Else\n\nLicensed under Something.\n");
    expect(resolveWebFonts(dir).notice).toContain("Somebody Else");
  });

  it("has no notice when there is nothing embedded to license", () => {
    writeFileSync(join(dir, "OFL.txt"), "Copyright 2024 The Geist Project Authors\n");
    expect(resolveWebFonts(dir).notice).toBeUndefined();
  });

  it("has no notice when the faces are embedded but OFL.txt is absent", () => {
    // Reported by its absence rather than invented: a face with no licence
    // file next to it is a state the operator needs to see, not one this
    // module papers over with a remembered notice.
    writeFileSync(join(dir, "Geist-Regular.ttf"), FAKE_TTF);
    expect(resolveWebFonts(dir).notice).toBeUndefined();
  });

  it("never embeds a system font: absent assets means absent embed, not a system face", () => {
    // The licence reason this differs from card-image.ts's satori path:
    // satori needs bytes in-process to rasterise, and those bytes never
    // leave the machine. A page embeds its bytes into a document that ships,
    // so embedding a system face would redistribute it. A missing asset face
    // degrades to naming the family in the CSS stack, never to shipping it.
    mkdirSync(join(dir, "empty"), { recursive: true });
    const fonts = resolveWebFonts(join(dir, "empty"));
    expect(fonts.display).toBeUndefined();
    expect(fonts.body).toBeUndefined();
  });
});
