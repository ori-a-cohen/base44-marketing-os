#!/usr/bin/env bash
# Stop hook: every guardian verdict must have a card. Runs after the turn
# ends, so no path can quietly skip logging -- it scans the transcript,
# creates any card a verdict is missing (via src/cards/reconcile.ts, which
# writes through the same store the rest of the system reads), and, only
# when BOARD_URL and BOARD_INGEST_TOKEN are both set, posts the newly
# created cards to the shared board. Local reconciliation always runs; the
# board POST is the only part gated by those two env vars -- their absence
# is a silent no-op for the network step, not for the local record.
#
# Never crashes the session: every external call below is guarded so a
# missing store, a malformed payload, an unreachable board, or a tsx
# failure degrades to a clean exit 0, never a stack trace surfaced to the
# turn.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAYLOAD="$(cat)"

# Single node invocation reads the whole Stop-hook payload once from stdin
# (never interpolated into the -e script text -- that is what keeps this
# injection-proof against a transcript path or turn content containing
# quotes, backticks, $(...), or backslashes) and emits just the
# transcript_path field Claude Code's Stop-hook JSON carries. Malformed or
# empty stdin yields an empty string, never a thrown error.
TRANSCRIPT="$(printf '%s' "$PAYLOAD" | node -e '
  let s = "";
  process.stdin.on("data", (d) => { s += d; });
  process.stdin.on("end", () => {
    let j;
    try { j = JSON.parse(s); } catch { j = null; }
    const path = (j && typeof j === "object" && typeof j.transcript_path === "string") ? j.transcript_path : "";
    process.stdout.write(path);
  });
' 2>/dev/null)"

[ -n "$TRANSCRIPT" ] || exit 0

CARDS_PATH="${CARDS_PATH:-data/cards.jsonl}"

# reconcile() itself never throws on missing files/malformed transcript
# lines (see src/cards/reconcile.ts), but tsx/node startup failure is
# still guarded here so a broken toolchain can never fail the turn.
# src/cards/cli-reconcile.ts prints newly created cards' full JSON (one per
# line) to stdout for the board-post step below; every other message goes
# to stderr, labelled, so it is visible without affecting what this
# variable captures. A real file, not an inline `tsx -e` script -- tsx's
# `-e` cannot resolve the relative imports reconcile.ts needs (see that
# file's header comment).
NEW_CARDS="$(
  cd "$ROOT" && \
  CARDS_PATH="$CARDS_PATH" TRANSCRIPT_PATH="$TRANSCRIPT" npx tsx src/cards/cli-reconcile.ts
)"
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "reconcile: local reconciliation step failed (exit $STATUS), continuing" >&2
  NEW_CARDS=""
fi

# The board is a best-effort projection; the local card record above is
# already the source of truth by this point. Only the cards this run
# actually created are posted (never the whole store), so a repeated Stop
# event never re-sends cards the board already has.
if [ -n "${BOARD_URL:-}" ] && [ -n "${BOARD_INGEST_TOKEN:-}" ] && [ -n "$NEW_CARDS" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if ! curl -sS -m 5 -X POST "$BOARD_URL/api/cards" \
      -H "content-type: application/json" \
      -H "authorization: Bearer $BOARD_INGEST_TOKEN" \
      -d "$line" >/dev/null 2>&1; then
      echo "reconcile: board POST failed (board unreachable or rejected the card), local record stands" >&2
    fi
  done <<< "$NEW_CARDS"
fi

exit 0
