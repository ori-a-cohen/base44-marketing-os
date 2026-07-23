import { readFileSync } from "node:fs";
import { verifyPageHtml } from "./page.js";

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: npm run verify:page -- <path-to-html>\n");
  process.exit(1);
}

const result = await verifyPageHtml(readFileSync(path, "utf8"));

// Kept distinct from both PASS and FAIL: a page nobody could check (no
// Chromium installed) is not the same outcome as a page that was checked and
// found wanting, and collapsing the two would either hard-crash a cold clone
// with no browser installed (if treated as an uncaught error) or silently
// report success on a check that never ran (if treated as PASS). Exit code
// 3 lets a caller (Task 20's build CLI, Task 21's demo script) tell "could
// not verify" apart from "verified: fail" (2) and "verified: pass" (0), and
// install the browser before retrying rather than treating this as either.
if (result.skippedReason) {
  process.stderr.write(`SKIPPED ${path}\n  - ${result.skippedReason}\n`);
  process.exit(3);
}

if (result.pass) {
  process.stdout.write(`PASS ${path}\n`);
  process.exit(0);
}
process.stderr.write(`FAIL ${path}\n`);
for (const f of result.failures) process.stderr.write(`  - ${f}\n`);
process.exit(2);
