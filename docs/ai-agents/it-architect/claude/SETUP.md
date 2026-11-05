# Claude setup: the architect in Claude Code

Facts checked against the Claude Code docs on 2026-10-31 (code.claude.com/docs:
`sub-agents`, `skills`, `hooks`, `permissions`, `agent-sdk/subagents`) and the Claude
prompting guide (platform.claude.com, "prompting best practices").

## What you get

| File (copy to the repository root) | What it is |
| --- | --- |
| `.claude/agents/architect.md` | The architect: Opus, effort high, project memory, two skills preloaded, a guard hook |
| `.claude/agents/arch-scout.md` | A cheap Haiku searcher the architect hands wide sweeps to |
| `.claude/skills/architecture-review/` | Review procedure, this repo's invariant checklist, `scripts/fitness.sh` |
| `.claude/skills/adr/` | ADR procedure and the house template |
| `.claude/hooks/architect-guard.sh` | Runs only while the architect runs: it may write only to docs, and it may not push, migrate, deploy or read secrets |
| `settings.snippet.json` | Deny rules for secrets, plus a few read-only allows. Merge them into `.claude/settings.json` |

## Why it is built this way (efficiency on Claude)

- **A subagent, not an output style.** The architect gets its own context window, its own
  model and effort, and its own tools. The main session stays on the coding model and
  gets back only the architect's conclusion. Output styles apply only to the main
  conversation, and they are advice the model follows, not limits it must obey.
- **CLAUDE.md is not repeated.** Subagents load the CLAUDE.md files themselves. The prompt
  therefore holds only the role, a map of the documents and the working rules (about 1,000
  words). Procedures sit in skills: their descriptions stay in context, and the body loads
  only when a skill runs.
- **Mechanical checks run as a script.** `fitness.sh` checks imports, migrations and the
  ADR index in under a second. Without it the model would read every file to find the same
  things.
- **Cheap search, expensive judgement.** `arch-scout` runs on Haiku with
  `omitClaudeMd: true`, so it does not load the 35 KB CLAUDE.md. Opus at effort `high`
  does the reasoning. Raise it to `xhigh`, or set the model to `fable` (Claude Fable 5.1),
  only for a decision your evals show needs it.
- **Stable prefix, good cache.** Model and effort are pinned in frontmatter. Changing either
  in the middle of a session invalidates the prompt cache.
- **Written the way Claude 5 models respond to best.** One role sentence, sections in XML
  tags, and a reason with each rule instead of capital letters. There is one explicit rule
  for when to delegate, because Opus tends to delegate too much.
- **Enforced by code, not by the prompt.** A hook enforces the write and command limits. A
  prompt only asks for them.

## Steps

1. **Review the files** in this folder, especially the prompt in `architect.md` and the
   checklist.
2. **Copy them into place** from the repository root:
   ```bash
   cp -R docs/ai-agents/it-architect/claude/.claude/agents docs/ai-agents/it-architect/claude/.claude/skills docs/ai-agents/it-architect/claude/.claude/hooks .claude/
   ```
   ```bash
   chmod +x .claude/hooks/architect-guard.sh .claude/skills/architecture-review/scripts/fitness.sh
   ```
3. **Merge the settings.** Copy the `permissions` block from `settings.snippet.json` into
   `.claude/settings.json`. Create that file if it does not exist; it is committed, unlike
   `settings.local.json`. A `Read` deny also blocks `Edit` and `Write`. `Read(/.env.*)`
   also hides `.env.example`; remove that rule if you want agents to read the example file.
4. **Trust the workspace.** Hooks in a project subagent run only in a trusted workspace,
   and a `claude -p` run does not count as trusted. Open `claude` once in the repository and
   accept the trust prompt.
5. **Check that it loads.** Start `claude` and ask:
   *"Use the architect agent: which internal/domain packages import another, and is that a
   problem?"* (task 9 of `../evals.md`).
6. **Run the evaluation** in `../evals.md`. Fix the prompt or the checklist where the agent
   scores 0 or 1, then run it again.
7. **Commit** `.claude/agents`, `.claude/skills`, `.claude/hooks` and `.claude/settings.json`.
   `.claude/agent-memory/architect/` appears after the first runs. Commit it too if you want
   the memory shared and reviewed; otherwise add it to `.gitignore`.

## How to use it

| You want | Do |
| --- | --- |
| A quick architecture opinion during coding work | Ask the main session; it delegates by the description, or write "use the architect agent" or `@architect` |
| A whole architecture session (design, an ADR) | `claude --agent architect`. The architect becomes the main thread and can hand sweeps to `arch-scout`. Its prompt replaces Claude Code's default prompt |
| Review a branch before merging | `/architecture-review` (main session), or "architect: review this branch" |
| Draft an ADR | `/adr outbox for cross-context reactions` |
| A run without a terminal, for CI or a script | `claude -p --agent architect "review the diff against main"` (hooks need trust, see step 4), or the Agent SDK below |

## Optional: the same agent in the Claude Agent SDK

Use this for a scheduled or CI review outside Claude Code. The agent definition mirrors
the frontmatter. Hooks are not part of the SDK's `AgentDefinition`, so the guard has to be
passed as an SDK hook, or the run kept read-only.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";

const prompt = readFileSync(".claude/agents/architect.md", "utf8").split(/^---$/m)[2];

for await (const msg of query({
  prompt: "Run the architecture-review skill on the diff against main and report.",
  options: {
    settingSources: ["project"],                 // loads CLAUDE.md, skills, settings
    systemPrompt: { type: "preset", preset: "claude_code" },
    allowedTools: ["Read", "Grep", "Glob", "Bash", "Skill", "Agent"],
    agents: {
      architect: {
        description: "IT architect for PPE-next2 (see .claude/agents/architect.md)",
        prompt, model: "opus", effort: "high",
        tools: ["Read", "Grep", "Glob", "Bash", "Skill"],
        skills: ["architecture-review", "adr"],
      },
    },
  },
})) if (msg.type === "result") console.log(msg.result);
```

Not checked against a live run: whether `settingSources` also loads `.claude/agents/`
(the inline definition above makes that question moot).

## Keep it healthy

- Rerun `../evals.md` after any change to the prompt, the skills, the model or CLAUDE.md.
- When a new invariant lands in CLAUDE.md or a spec, add one line to `checklist.md`.
- When a domain import is judged fine, add the pair to `fitness.sh` with its reason. Once
  ADR 0001's import test exists, delete the script's first check.
- Read `.claude/agent-memory/architect/` now and then, and delete what the repository has
  since made true or false.
