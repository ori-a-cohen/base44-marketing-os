import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("skills", () => {
  it("launch-campaign has frontmatter with a name and description", () => {
    const md = read("skills/launch-campaign/SKILL.md");
    expect(md.startsWith("---")).toBe(true);
    expect(md).toMatch(/^name:\s*launch-campaign/m);
    expect(md).toMatch(/^description:\s*\S/m);
  });

  it("launch-campaign runs both gates in order and never skips the design gate", () => {
    const md = read("skills/launch-campaign/SKILL.md");
    expect(md).toContain("brand-guardian");
    expect(md).toContain("design-guardian");
    expect(md).toContain("verify:page");
  });

  it("measure refuses to let seeded data reach the metric", () => {
    expect(read("skills/measure/SKILL.md").toLowerCase()).toContain("seeded");
  });

  it("rule-audit names the selection effect", () => {
    expect(read("skills/rule-audit/SKILL.md").toLowerCase()).toContain("selection effect");
  });

  it("the router points at the new skills", () => {
    const md = read("skills/marketing-router/SKILL.md");
    expect(md).toContain("launch-campaign");
    expect(md).toContain("measure");
  });
});
