import { reconcile } from "./reconcile.js";
import { readCards } from "./store.js";

/**
 * The process entrypoint `hooks/reconcile.sh` invokes via `npx tsx`. A real
 * file rather than an inline `tsx -e` script deliberately: tsx's `-e`
 * evaluates the given code as a virtual `[eval]` module with no real file
 * path backing it, so a relative import inside it (e.g.
 * `import ... from "./reconcile.js"`) can never resolve -- it always
 * throws MODULE_NOT_FOUND. Every other CLI entrypoint in this repo
 * (cli-brand.ts, cli-design.ts, cli-measure.ts, verify/cli.ts) is a real
 * file for the same reason; this follows that pattern rather than
 * reintroducing the bug.
 *
 * Reads TRANSCRIPT_PATH and CARDS_PATH from the environment (set by the
 * calling hook), never from argv or stdin -- the hook already validated
 * and quoted these as shell values before exporting them.
 */
const transcriptPath = process.env.TRANSCRIPT_PATH ?? "";
const cardsPath = process.env.CARDS_PATH ?? "data/cards.jsonl";

const result = reconcile(transcriptPath, cardsPath);
for (const message of result.flagged) {
  process.stderr.write(`reconcile: ${message}\n`);
}

if (result.created.length > 0) {
  const created = new Set(result.created);
  for (const card of readCards(cardsPath)) {
    if (created.has(card.id)) process.stdout.write(`${JSON.stringify(card)}\n`);
  }
}
