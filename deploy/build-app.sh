#!/bin/sh
# Builds one published app (ADR 0006, phase 3) as it was at a git ref and
# writes its dist/ to standard output as a tar, for `api -publish-app`
# (`make prod-publish`). The ref's own web/Dockerfile builds it (stage
# app-dist), in a worktree of the ref, so the deployed checkout is untouched.
#
#   deploy/build-app.sh <app folder, e.g. sim-scan> <git ref>
set -eu
app=$1
ref=$2
tmp=$(mktemp -d)
cleanup() {
	git worktree remove --force "$tmp/src" 2>/dev/null || true
	rm -rf "$tmp"
}
trap cleanup EXIT INT TERM
git worktree add --quiet --detach "$tmp/src" "$ref" >&2
docker build --quiet --target app-dist --build-arg APP="$app" --output "type=local,dest=$tmp/dist" "$tmp/src/web" >&2
test -f "$tmp/dist/ppe-app.json" || { echo "$app at $ref has no ppe-app.json: it is not a published app there" >&2; exit 1; }
tar -C "$tmp/dist" -cf - .
