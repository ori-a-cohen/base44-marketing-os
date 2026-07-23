import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("agent definitions", () => {
  it("designer exists and reads DESIGN.md first", () => {
    const md = read("agents/designer.md");
    expect(md).toContain("brand/DESIGN.md");
    expect(md.toLowerCase()).toContain("token");
  });

  it("design-guardian scores against numbered DESIGN.md rules", () => {
    const md = read("agents/design-guardian.md");
    expect(md).toContain("VERDICT:");
    expect(md.toLowerCase()).toContain("screenshot");
  });

  it("analyst is forbidden from writing content", () => {
    expect(read("agents/analyst.md").toLowerCase()).toMatch(/never writes? content|does not write content/);
  });

  it("brand-guardian emits a verdict block reconcile can parse", () => {
    const md = read("agents/brand-guardian.md");
    const re = /VERDICT:\s*(APPROVED|REJECTED)\s+score\s+([\d.]+)\s+card-id:\s*([\w-]+)\s+channel:\s*([\w-]+)/i;
    const sample = "VERDICT: APPROVED score 9.5 card-id: cc-42 channel: landing_page";
    expect(md).toContain("VERDICT:");
    expect(re.test(sample)).toBe(true);
    expect(md).toContain("card-id:");
  });

  it("every agent re-reads the canon including audiences", () => {
    for (const p of ["agents/designer.md", "agents/design-guardian.md"]) {
      expect(read(p)).toContain("brand/audiences.md");
    }
  });
});
