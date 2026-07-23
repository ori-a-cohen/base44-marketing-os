#!/usr/bin/env bash
# PreToolUse hook: the Brain's rules, enforced by the filesystem.
# Off-brand copy cannot reach disk. Exit 2 blocks the write and returns
# stderr to the model, which must fix it and try again.
#
# Scope: MARKETING COPY ONLY, matched positively. Everything that is not a
# draft or a generated artifact is out of scope by default -- the canon defines
# banned words, memory records them, code implements the checks, and repo
# documentation discusses them. An exempt-list would have to anticipate every
# one of those; a match-list only has to name the two places copy actually lives.
#
# Severity: this script never decides block-vs-warn itself. It pipes the
# candidate text to src/lint/cli-brand.ts (Task 5) and propagates that
# process's exit code unchanged -- 0 for clean or warn-only copy, 2 when a
# "block"-severity finding is present, 3 if the CLI cannot read its stdin.
# Re-deriving that logic here would let this hook drift out of sync with the
# severity tier the linter already implements.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAYLOAD="$(cat)"

read_json() { printf '%s' "$PAYLOAD" | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try{const j=JSON.parse(s);const v=$1;process.stdout.write(v==null?'':String(v));}
    catch{process.stdout.write('');}
  });"; }

TOOL="$(read_json 'j.tool_name')"
case "$TOOL" in Write|Edit|MultiEdit) ;; *) exit 0 ;; esac

FILE="$(read_json 'j.tool_input && (j.tool_input.file_path||j.tool_input.filePath)')"
[ -n "$FILE" ] || exit 0

# The only two places marketing copy lives: drafts and generated artifacts.
case "$FILE" in
  content/*|*/content/*) ;;
  build/pages/*|*/build/pages/*) ;;
  *) exit 0 ;;
esac

CONTENT="$(read_json 'j.tool_input && (j.tool_input.content||j.tool_input.new_string||"")')"
[ -n "$CONTENT" ] || exit 0

printf '%s' "$CONTENT" | (cd "$ROOT" && npx tsx src/lint/cli-brand.ts)
