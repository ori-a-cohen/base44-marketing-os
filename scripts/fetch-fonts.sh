#!/usr/bin/env bash
# Downloads Geist (SIL Open Font License -- redistribution explicitly
# permitted, provided the licence notice ships with it) from vercel/geist-font
# into assets/fonts/, plus that repo's OFL.txt. Dazzed is deliberately never
# fetched here, or anywhere else in this repo: its licence permits personal
# and commercial USE but not redistributing the font file itself, so this
# script has no redistributable source to fetch it from. See
# assets/fonts/README.md and the "Known glyph exceptions" note in
# brand/DESIGN.md for the operator-facing explanation, and task-13's report
# for the licensing table this decision is based on.
#
# Called by scripts/demo.sh (Task 21) before any card is rendered, and safe
# to run directly: `./scripts/fetch-fonts.sh`.
#
# Idempotent: if a target file already exists and is non-empty, it is left
# alone and reported as already present rather than re-downloaded. Every
# download lands in a temp file first and is moved into place only after a
# full, verified transfer -- a failed or interrupted download can never
# leave a truncated file at the real path; re-running after a failure starts
# clean instead of resuming (or trusting) a partial file.
#
# Every path below is quoted: this repo's root directory name contains a
# space ("Base44 MarketingOS"), and an unquoted path here would silently
# split into two arguments.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FONTS_DIR="$ROOT/assets/fonts"
BASE_URL="https://raw.githubusercontent.com/vercel/geist-font/main"

mkdir -p "$FONTS_DIR"

# Downloads one file, atomically. Returns non-zero (without leaving any
# trace at the real destination) on any failure: a non-2xx response, a
# network error, or a transfer that completes but is empty.
fetch_one() {
  local dest_name="$1"
  local remote_path="$2"
  local dest_path="$FONTS_DIR/$dest_name"

  if [ -s "$dest_path" ]; then
    echo "fetch-fonts: $dest_name already present, skipping"
    return 0
  fi

  local tmp_path
  tmp_path="$(mktemp "$FONTS_DIR/.${dest_name}.XXXXXX.tmp")"

  echo "fetch-fonts: downloading $dest_name from $BASE_URL/$remote_path"
  if curl -fsSL "$BASE_URL/$remote_path" -o "$tmp_path" && [ -s "$tmp_path" ]; then
    mv "$tmp_path" "$dest_path"
    echo "fetch-fonts: saved $dest_name ($(wc -c < "$dest_path" | tr -d ' ') bytes)"
    return 0
  fi

  rm -f "$tmp_path"
  echo "fetch-fonts: ERROR failed to download $dest_name from $BASE_URL/$remote_path" >&2
  return 1
}

STATUS=0
fetch_one "Geist-Regular.ttf" "fonts/Geist/ttf/Geist-Regular.ttf" || STATUS=1
fetch_one "Geist-Bold.ttf" "fonts/Geist/ttf/Geist-Bold.ttf" || STATUS=1
fetch_one "OFL.txt" "OFL.txt" || STATUS=1

if [ "$STATUS" -ne 0 ]; then
  echo "fetch-fonts: one or more downloads failed; re-run this script to retry." >&2
  echo "fetch-fonts: nothing truncated was left behind -- any file above that" >&2
  echo "fetch-fonts: reported ERROR simply does not exist yet at $FONTS_DIR." >&2
  exit 1
fi

echo "fetch-fonts: done. Geist is ready in $FONTS_DIR."
echo "fetch-fonts: Dazzed is never fetched here -- see assets/fonts/README.md."
