#!/usr/bin/env bash
# PreToolUse hook: no visual value reaches disk unless it came from DESIGN.md.
# A blocking finding exits 2 and stops the write, returning stderr to the
# model, which must fix it and try again. Clean or warn-only content exits 0
# and the write proceeds -- see the severity note in src/lint/cli-design.ts.
#
# Scope: GENERATED VISUAL ARTIFACTS ONLY, matched positively -- build/pages/*
# is the same location brand-lint.sh already treats as "where generated
# pages live", narrowed further to the file types that actually carry CSS/
# SVG colour declarations. Everything else -- the token file itself, source
# code, tests, memory, repo documentation -- is out of scope by default:
# those files legitimately contain and discuss hex values. An exempt-list
# would have to anticipate every one of them; a match-list only has to name
# where generated artifacts land.
#
# Severity: this script never decides block-vs-warn itself. It pipes the
# candidate text to src/lint/cli-design.ts (Task 8) and propagates that
# process's exit code unchanged -- 0 for clean or warn-only content, 2 when a
# "block"-severity finding is present, 3 if the CLI cannot read its stdin.
# Re-deriving that logic here would let this hook drift out of sync with the
# severity tier the linter already implements.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAYLOAD="$(cat)"

# Single node invocation reads the whole payload once from stdin (never
# interpolated into the -e script text -- that is what keeps this
# injection-proof against content containing quotes, backticks, $(...), or
# backslashes) and emits exactly the three fields the rest of the script
# needs, one field per "line": tool name, file path, and the candidate text.
# The candidate text is written last and un-terminated so it can itself
# contain embedded newlines without being mistaken for extra fields.
#
# Content sources, all optional and independently malformed-safe:
#   - tool_input.content      (Write)
#   - tool_input.new_string   (Edit)
#   - tool_input.edits[].new_string (MultiEdit, one per hunk)
# Every source that is present contributes; a MultiEdit's hunks are joined
# with newlines so an off-token value in any one hunk is caught, not just
# the first.
FIELDS="$(printf '%s' "$PAYLOAD" | node -e '
  let s = "";
  process.stdin.on("data", (d) => { s += d; });
  process.stdin.on("end", () => {
    let j;
    try { j = JSON.parse(s); } catch { j = null; }
    const input = (j && typeof j === "object" && j.tool_input) || {};
    const tool = (j && typeof j === "object" && j.tool_name) || "";
    const file = (input && (input.file_path || input.filePath)) || "";

    const parts = [];
    if (typeof input.content === "string") parts.push(input.content);
    if (typeof input.new_string === "string") parts.push(input.new_string);
    if (Array.isArray(input.edits)) {
      for (const edit of input.edits) {
        if (edit && typeof edit === "object" && typeof edit.new_string === "string") {
          parts.push(edit.new_string);
        }
      }
    }
    const content = parts.join("\n");

    process.stdout.write(String(tool) + "\n" + String(file) + "\n" + content);
  });
')"

TOOL="$(printf '%s\n' "$FIELDS" | sed -n '1p')"
FILE="$(printf '%s\n' "$FIELDS" | sed -n '2p')"
CONTENT="$(printf '%s\n' "$FIELDS" | tail -n +3)"

case "$TOOL" in Write|Edit|MultiEdit) ;; *) exit 0 ;; esac
[ -n "$FILE" ] || exit 0

# Generated visual artifacts only: the one location build/pages/* actually
# uses, restricted to the file types that carry CSS/SVG colour declarations.
case "$FILE" in
  build/pages/*|*/build/pages/*) ;;
  *) exit 0 ;;
esac
case "$FILE" in
  *.html|*.svg|*.css) ;;
  *) exit 0 ;;
esac

[ -n "$CONTENT" ] || exit 0

printf '%s' "$CONTENT" | (cd "$ROOT" && npx tsx src/lint/cli-design.ts)
