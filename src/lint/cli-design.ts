import { readFileSync, existsSync } from "node:fs";
import type { DesignTokens } from "./tokens.js";
import { parseTokens, findOffTokenValues } from "./tokens.js";

/**
 * Reads the candidate text on stdin, prints findings on stderr, and exits 2
 * only when at least one "block"-severity finding is present so a
 * PreToolUse hook blocks the write. "warn"-severity findings are always
 * printed but never affect the exit code on their own.
 *
 * This mirrors src/lint/cli-brand.ts's exit contract exactly:
 * findOffTokenValues currently returns only "block" findings, but this CLI
 * still implements the full severity split so it does not silently drift
 * out of sync with that contract the day a "warn" finding is added to
 * tokens.ts. Re-deriving block-vs-warn logic in the calling shell script
 * would create exactly that drift risk.
 *
 * Exit codes: 0 clean or warn-only, 2 blocked (a block finding is present),
 * 3 stdin unreadable. A hook must be able to tell "blocked" apart from "the
 * linter itself broke", so an I/O failure never collapses onto 0 or 2.
 */
const STDIN_READ_FAILURE_EXIT_CODE = 3;

// A URL object (not its .pathname string) is passed straight to fs's
// PathLike-accepting functions below: Node decodes the URL itself, so a
// repo path containing a space (percent-encoded to %20 in the URL) resolves
// correctly. Stringifying via .pathname first would hand fs the still-encoded
// text and silently fail existsSync/readFileSync -- that exact bug shipped
// once in this project (see src/lint/cli-brand.ts) and disabled an entire
// lint rule without raising an error.
const designUrl = new URL("../../brand/DESIGN.md", import.meta.url);

const EMPTY_TOKENS: DesignTokens = { colors: {}, typography: {}, spacing: {} };

function loadTokens(): DesignTokens {
  try {
    if (!existsSync(designUrl)) {
      process.stderr.write(
        `design-lint: canon not found at ${designUrl}, linting against an empty token set.\n`,
      );
      return EMPTY_TOKENS;
    }
    return parseTokens(readFileSync(designUrl, "utf8"));
  } catch (error) {
    // parseTokens throws by design on missing/malformed front matter (see
    // tokens.ts): "the canon is malformed" must stay distinguishable from
    // "a token group is absent" there. This catch is where the project's
    // separate binding constraint -- a missing or malformed DESIGN.md must
    // never crash the caller -- is actually satisfied: degrade to an empty
    // token set and keep going, don't let the exception break the turn.
    process.stderr.write(
      `design-lint: failed to read canon (${(error as Error).message}), linting against an empty token set.\n`,
    );
    return EMPTY_TOKENS;
  }
}

let text: string;
try {
  text = readFileSync(0, "utf8");
} catch (error) {
  process.stderr.write(`design-lint: failed to read stdin (${(error as Error).message}).\n`);
  process.exit(STDIN_READ_FAILURE_EXIT_CODE);
}

const tokens = loadTokens();
const findings = findOffTokenValues(text, tokens);
if (findings.length === 0) process.exit(0);

const blocking = findings.filter((f) => f.severity === "block");
const warnings = findings.filter((f) => f.severity === "warn");

if (warnings.length > 0) {
  process.stderr.write("WARNED by design-lint (advisory, does not block):\n\n");
  for (const f of warnings) {
    process.stderr.write(`  ${f.message}\n    ...${f.excerpt}...\n\n`);
  }
}

if (blocking.length === 0) process.exit(0);

process.stderr.write("BLOCKED by design-lint. Every visual value comes from DESIGN.md tokens:\n\n");
for (const f of blocking) {
  process.stderr.write(`  ${f.message}\n    ...${f.excerpt}...\n\n`);
}
process.exit(2);
