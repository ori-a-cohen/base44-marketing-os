import { readFileSync, existsSync } from "node:fs";
import type { VocabSwap } from "./brand.js";
import { lintBrand, parseVocabulary } from "./brand.js";

/**
 * Reads the candidate text on stdin, prints findings on stderr,
 * exits 2 only when at least one "block"-severity finding is present so a
 * PreToolUse hook blocks the write. "warn"-severity findings (judgment
 * calls for the brand-guardian agent, not the mechanical linter) are always
 * printed but never affect the exit code on their own.
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
// text and silently fail existsSync/readFileSync, which is exactly the bug
// this fixes. It also sidesteps a latent Windows leading-slash bug in
// .pathname.
const guideUrl = new URL("../../brand/voice-guide.md", import.meta.url);

function loadVocabulary(): readonly VocabSwap[] {
  try {
    if (!existsSync(guideUrl)) {
      process.stderr.write(
        `brand-lint: canon not found at ${guideUrl}, linting against an empty vocabulary.\n`,
      );
      return [];
    }
    return parseVocabulary(readFileSync(guideUrl, "utf8"));
  } catch (error) {
    process.stderr.write(
      `brand-lint: failed to read canon (${(error as Error).message}), linting against an empty vocabulary.\n`,
    );
    return [];
  }
}

let text: string;
try {
  text = readFileSync(0, "utf8");
} catch (error) {
  process.stderr.write(`brand-lint: failed to read stdin (${(error as Error).message}).\n`);
  process.exit(STDIN_READ_FAILURE_EXIT_CODE);
}

const vocab = loadVocabulary();
const findings = lintBrand(text, vocab);
if (findings.length === 0) process.exit(0);

const blocking = findings.filter((f) => f.severity === "block");
const warnings = findings.filter((f) => f.severity === "warn");

if (warnings.length > 0) {
  process.stderr.write("WARNED by brand-lint (advisory, does not block). For the brand-guardian to judge:\n\n");
  for (const f of warnings) {
    process.stderr.write(`  [rule ${f.rule}] ${f.message}\n    ...${f.excerpt}...\n\n`);
  }
}

if (blocking.length === 0) process.exit(0);

process.stderr.write("BLOCKED by brand-lint. Fix these before writing:\n\n");
for (const f of blocking) {
  process.stderr.write(`  [rule ${f.rule}] ${f.message}\n    ...${f.excerpt}...\n\n`);
}
process.exit(2);
