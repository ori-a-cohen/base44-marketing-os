#!/usr/bin/env bash
# The 90-second demo. Runs the whole marketing-ops loop on a fresh clone with
# zero API keys: fetch fonts -> seed one approved card -> build its page and
# social-card artifacts -> verify the page in a real headless browser ->
# measure a genuine local visit -> serve and prove the board -> stop cleanly.
#
# Repo root is resolved from BASH_SOURCE, never $0 or a bare `new URL(...)`,
# and never assumed from cwd -- this repo's root directory name contains a
# space ("Base44 MarketingOS"), so every path below is double-quoted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export CARDS_PATH="${CARDS_PATH:-data/cards.jsonl}"
export VISITS_PATH="${VISITS_PATH:-data/visits.jsonl}"
export PORT="${PORT:-4174}"

SERVER_PID=""

# Always stop the board server on exit -- success, failure, or Ctrl-C -- so a
# run of this script never leaves an orphaned node process holding the port
# open. This is what makes it safe to run the demo (and the acceptance test
# that drives it as a subprocess) twice in a row.
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "1/7  fetching fonts"
# Best-effort: assets/fonts/ is gitignored and empty on a fresh clone.
# fetch-fonts.sh is idempotent (skips files already present) and atomic (never
# leaves a truncated file behind). If this fails outright -- no network -- the
# renderer still works: it falls back to a system face and labels it, so the
# demo continues rather than treating an offline font fetch as fatal.
"$ROOT/scripts/fetch-fonts.sh" || echo "    continuing without Geist -- renderer falls back to a system face"

echo "2/7  seeding the starter's example cards and one approved card"
mkdir -p "$(dirname "$CARDS_PATH")"

# The starter's own example cards, copied verbatim from the v1.0 assignment
# data. They are the baseline card shape and exercise what cc-demo cannot:
# three channels outside the surface registry (linkedin, email, x), real
# guardian scores across all three rules.md bands, a legacy "review" status,
# and an off-platform evidence URL. Never edited here -- in particular
# cc-001 claims "shipped" with no shipped_at, which loop-closure reports as
# malformed rather than folding into "in flight". Giving it a ship time to
# tidy the headline would be fabricating one.
#
# They add nothing to the metric: none carries an outcome, so the numerator
# is untouched; cc-002/cc-003 never shipped, so they are not eligible; and
# none carries an audience, campaign or verdict, so cohorts and rule
# accountability are untouched too.
cat data/content-cards.example.jsonl > "$CARDS_PATH"

cat >> "$CARDS_PATH" <<'JSON'
{"id":"cc-demo","channel":"landing_page","topic":"Base1 launch","status":"approved","created":"2026-07-23","audience_id":"solo-builder","campaign_id":"base1-launch","verdicts":[{"rule":4,"pass":true,"note":"every claim traced to data/source-base1.md","gate":"brand"}]}
JSON

echo "3/7  building the landing page and social card"
# Wrapped in an async IIFE with a dynamic import, not a top-level static
# import + top-level await: `tsx -e` transforms an eval string as CJS
# regardless of this package's "type": "module", and esbuild rejects
# top-level await under the CJS output format ("Top-level await is currently
# not supported with the \"cjs\" output format"). The IIFE sidesteps that --
# the await is inside a function, never at module top level.
npx tsx -e '
  (async () => {
    const { buildCard } = await import("./src/render/cli-build.js");
    await buildCard({
      cardsPath: process.env.CARDS_PATH,
      outDir: "build/pages",
      withImage: false,
      spec: {
        cardId: "cc-demo", slug: "base1",
        headline: "Base1 builds your app",
        subhead: "Base44 first in-house model, trained on real building patterns.",
        body: "Released 29 June 2026. Available in the model selector.",
        ctaLabel: "Start building", ctaHref: "https://base44.com",
        audienceId: "solo-builder", campaignId: "base1-launch",
      },
    });
  })();
'

echo "4/7  backdating the ship time so the loop-closure maturity window has already elapsed"
# landing_page's tMatureMs (src/metric/surfaces.ts) is a 15-minute grace
# period before a shipped card enters loopClosure's denominator at all -- by
# design, so a card cannot claim to be "measured" the instant it ships. A
# 90-second demo cannot wait out that window in real time, so this backdates
# shipped_at by 20 minutes -- a demo-clock convenience, exactly like the
# injectable `now` every measurement function in this codebase already
# accepts for tests. It never touches the outcome itself: the value,
# provenance, and source that make the loop-closure number honest all still
# come from the real local-visits fetch in the next step, untouched.
npx tsx -e '
  (async () => {
    const { readCards, upsertCard } = await import("./src/cards/store.js");
    const cardsPath = process.env.CARDS_PATH;
    const card = readCards(cardsPath).find((c) => c.id === "cc-demo");
    if (!card) throw new Error("cc-demo not found after build");
    const shippedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    upsertCard(cardsPath, {
      ...card,
      shipped_at: shippedAt,
      history: [...card.history, "demo: backdated shipped_at by 20m so the loop-closure maturity gate passes within the demo"],
    });
  })();
'

echo "5/7  verifying the rendered page"
# Ensures a Chromium binary is present before verify:page runs, rather than
# hoping the machine already has one -- this is the "installs the browser"
# half of the browser-install-vs-skip decision (see scripts/demo.sh's report).
# A no-op if already installed, so the acceptance test passes the same way
# whether or not the browser was preinstalled. If the install itself fails
# (offline), verify:page still runs and degrades to its documented exit-3
# skip instead of hanging or crashing the demo.
npx playwright install chromium >/dev/null 2>&1 || echo "    could not install Chromium (offline?) -- verify:page may report a labelled skip"

set +e
npm run --silent verify:page -- build/pages/cc-demo/index.html
VERIFY_STATUS=$?
set -e
case "$VERIFY_STATUS" in
  0) : ;; # PASS -- already printed above
  3) echo "    verify:page could not run (no browser available) -- continuing; see message above" ;;
  *) exit "$VERIFY_STATUS" ;; # a real FAIL (2) or unexpected error must stop the demo
esac

echo "6/7  measuring"
npm run --silent measure

echo "7/7  serving the board and proving it answers"
# Run the server as a direct node process (not `npx tsx`, whose child would
# orphan) so SERVER_PID is the real listener we can kill, and redirect its
# stdio to a log so it never holds the stdout pipe a parent execFileSync (the
# cold-clone acceptance test) captures -- an orphan holding that pipe hangs the
# parent forever, which is invisible on macOS but deadlocks Linux CI.
mkdir -p "${ROOT}/build"
node --import tsx src/board/server.ts >"${ROOT}/build/board-server.log" 2>&1 &
SERVER_PID=$!

# Poll the port rather than sleep-and-hope: bounded (10s) wait for the server
# to come up, deterministic either way.
UP=0
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/board" >/dev/null 2>&1; then
    UP=1
    break
  fi
  sleep 0.2
done
if [ "$UP" -ne 1 ]; then
  echo "board server did not come up on port ${PORT} within 10s" >&2
  exit 1
fi

curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" && echo "    GET /            -> OK"
curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/board" && echo "    GET /api/board   -> OK"

kill "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

echo
echo "Done. The loop closed with zero API keys."
echo "Run 'npm run board' any time to browse it live at http://127.0.0.1:${PORT}"
