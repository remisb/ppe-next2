#!/usr/bin/env bash
# PostToolUse (Edit/Write): keep the file Claude just wrote formatted and lint-clean.
# - Go: gofmt -w (CI fails on unformatted Go).
# - web TS/TSX: Biome lint on that one file; problems go back to Claude (exit 2) so it
#   fixes them in the same turn instead of in CI. Biome's formatter is off (web/biome.jsonc).
# Never blocks on a missing tool.
set -uo pipefail
f=$(jq -r '.tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0
case "$f" in
  *.go)
    command -v gofmt >/dev/null && gofmt -w "$f"
    ;;
  */web/*.ts|*/web/*.tsx)
    case "$f" in */node_modules/*|*/dist/*) exit 0 ;; esac
    web=${f%%/web/*}/web
    biome="$web/node_modules/.bin/biome"
    [ -x "$biome" ] || exit 0
    if ! out=$(cd "$web" && "$biome" lint --diagnostic-level=error --max-diagnostics=20 "$f" 2>&1); then
      printf 'Biome found problems in %s:\n%s\n' "$f" "$out" >&2
      exit 2
    fi
    ;;
esac
exit 0
