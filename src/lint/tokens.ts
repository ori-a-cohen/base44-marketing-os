import { parse as parseYaml } from "yaml";
import type { LintFinding } from "./brand.js";

export interface DesignTokens {
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
}

/** Strips a trailing "# comment" that sits outside quotes, then trims quotes. */
function cleanValue(value: unknown): string {
  return String(value).replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
}

function cleanGroup(group: unknown): Record<string, string> {
  if (typeof group !== "object" || group === null) return {};
  return Object.fromEntries(
    Object.entries(group as Record<string, unknown>).map(([k, v]) => [k, cleanValue(v)]),
  );
}

export function parseTokens(designMd: string): DesignTokens {
  const match = /^---\n([\s\S]*?)\n---/.exec(designMd);
  if (!match) throw new Error("DESIGN.md has no YAML front matter");
  const doc = parseYaml(match[1] as string) as Record<string, unknown>;
  return {
    colors: cleanGroup(doc.colors),
    typography: cleanGroup(doc.typography),
    spacing: cleanGroup(doc.spacing),
  };
}

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/**
 * A near-miss hex is a violation, not a rounding error (DESIGN.md, Colors).
 * Comparison is normalised, never eyeballed.
 */
export function findOffTokenValues(text: string, tokens: DesignTokens): LintFinding[] {
  const allowed = new Set(Object.values(tokens.colors).map((c) => c.toLowerCase()));
  const findings: LintFinding[] = [];

  let m: RegExpExecArray | null;
  HEX.lastIndex = 0;
  while ((m = HEX.exec(text)) !== null) {
    const hex = m[0].toLowerCase();
    if (allowed.has(hex)) continue;
    findings.push({
      rule: 0,
      severity: "block",
      message: `Off-token colour ${m[0]}. DESIGN.md allows only: ${[...allowed].join(", ")}.`,
      excerpt: text.slice(Math.max(0, m.index - 20), m.index + 30).replace(/\s+/g, " ").trim(),
    });
  }

  if (/linear-gradient|radial-gradient|conic-gradient/i.test(text)) {
    findings.push({
      rule: 0,
      severity: "block",
      message: "Gradients are a DESIGN.md violation: flat, branded backgrounds only.",
      excerpt: "gradient",
    });
  }

  if (/box-shadow\s*:\s*(?!none)/i.test(text)) {
    findings.push({
      rule: 0,
      severity: "block",
      message: "No elevation: DESIGN.md forbids drop shadows and floating panels.",
      excerpt: "box-shadow",
    });
  }

  return findings;
}
