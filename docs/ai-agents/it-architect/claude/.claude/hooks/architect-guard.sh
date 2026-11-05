#!/bin/sh
# PreToolUse guard for the architect agent (runs only while it runs).
# - Edit/Write: only architecture and developer documents, and its own memory.
# - Bash: nothing that pushes, deploys, migrates or changes a database or container.
# Input is the hook's JSON on stdin; exit 2 blocks the call and stderr is the reason.

input=$(cat)
field() { printf '%s' "$input" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('$1',''))"; }
tool=$(printf '%s' "$input" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_name',''))")

if [ "$tool" = "Bash" ]; then
  cmd=$(field command)
  case "$cmd" in
    *"git push"*|*"git commit"*|*"git reset"*|*"git checkout"*|*"git switch"*|*"make prod"*|*"make migrate"*|*"make db-"*|*"make seed"*|*"make import"*|*psql*|*"docker "*|*"rm -"*|*.env*|*github-token*)
      echo "The architect does not run commands that change git state, databases, containers or deployments, or that touch secrets. Say what should be run instead." >&2
      exit 2 ;;
  esac
  exit 0
fi

path=$(field file_path)
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
rel="${path#"$root"/}"
case "$rel" in
  docs/architecture/*|docs/specs/*|docs/ai-agents/*|docs/testing.md|docs/ubiquitous-language.md|.claude/agent-memory/*)
    exit 0 ;;
esac
echo "The architect writes only docs/architecture, docs/specs, docs/ai-agents, docs/testing.md and the glossary. Describe the change to $rel instead, so the main session or the user can make it." >&2
exit 2
