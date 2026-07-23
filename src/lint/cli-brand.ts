import { readFileSync, existsSync } from "node:fs";
import { lintBrand, parseVocabulary } from "./brand.js";

/**
 * Reads the candidate text on stdin, prints findings on stderr,
 * exits 2 when anything fails so a PreToolUse hook blocks the write.
 */
const text = readFileSync(0, "utf8");
const guidePath = new URL("../../brand/voice-guide.md", import.meta.url).pathname;
const vocab = existsSync(guidePath) ? parseVocabulary(readFileSync(guidePath, "utf8")) : [];

const findings = lintBrand(text, vocab);
if (findings.length === 0) process.exit(0);

process.stderr.write("BLOCKED by brand-lint. Fix these before writing:\n\n");
for (const f of findings) {
  process.stderr.write(`  [rule ${f.rule}] ${f.message}\n    ...${f.excerpt}...\n\n`);
}
process.exit(2);
