#!/usr/bin/env bash
# PreToolUse (Edit/Write): refuse changing a migration that is already on origin/main.
# Migrations are append-only once merged: production has applied them, and
# schema_migrations records only the file name. Exit 2 blocks the edit and tells Claude why.
set -uo pipefail
f=$(jq -r '.tool_input.file_path // empty')
case "$f" in
  */internal/db/migrations/*.sql) ;;
  *) exit 0 ;;
esac
root=$(git -C "$(dirname "$f")" rev-parse --show-toplevel 2>/dev/null) || exit 0
rel=${f#"$root/"}
if git -C "$root" cat-file -e "origin/main:$rel" 2>/dev/null; then
  echo "$rel is on origin/main, so production may have applied it: migrations are append-only. Write a new migration instead." >&2
  exit 2
fi
exit 0
