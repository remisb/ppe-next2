# OpenAI setup: the architect in Codex

Facts were checked against OpenAI's docs on 2026-10-31. The Codex docs now live at
learn.chatgpt.com/docs: `agent-configuration/agents-md`, `agent-configuration/subagents`,
`config-file/config-reference`, `build-skills`, `non-interactive-mode` and
`developer-commands`. The model guidance comes from developers.openai.com
(`api/docs/guides/latest-model`, prompt engineering). The model names match the list in
your own `~/.codex/models_cache.json`.

## What you get

| File | Copy to | What it is |
| --- | --- | --- |
| `.codex/architect-instructions.md` | repo `.codex/` | The role: identity, instructions, an example, then context (the order OpenAI recommends) |
| `.codex/agents/architect.toml` | repo `.codex/agents/` | The architect as a subagent: GPT-6 Astra, effort high |
| `.codex/agents/arch-scout.toml` | repo `.codex/agents/` | A cheap searcher on GPT-6 Luna |
| `.agents/skills/architecture-review/` | repo `.agents/skills/` | Review procedure, checklist, `scripts/fitness.sh` (the same content as Claude's) |
| `.agents/skills/adr/` | repo `.agents/skills/` | ADR procedure and template |
| `home/architect.config.toml` | `~/.codex/architect.config.toml` | Profile that turns a whole session into the architect, read-only by default |
| `review.schema.json` | repo `.codex/` | JSON schema for structured reviews from `codex exec` |

## Why it is built this way (efficiency on OpenAI)

- **Codex never reads CLAUDE.md.** It reads `AGENTS.md` from the repository root down to
  the current folder. It stops after 32 KiB (`project_doc_max_bytes`), and CLAUDE.md is
  35 KB. The root `AGENTS.md` today is a 209-byte stub. The architect's instructions
  therefore carry a compact map and the key invariants (about 1,000 words), and they read
  CLAUDE.md by section when needed. Pointing Codex at CLAUDE.md or symlinking it would
  silently cut off its last part.
- **One role file, two ways in.** The profile and the subagent both point to
  `.codex/architect-instructions.md`, so the two cannot drift apart. The cost is one file
  read at the start of each session. `model_instructions_file` would also work, but it
  replaces Codex's own instructions for its tools, so it is not used.
- **The model is matched to the job.** GPT-6 Astra at effort `high` does design and review.
  Use `xhigh` for a hard decision; a quick question runs fine on `gpt-6.1-sol` at
  `medium`, at about a fifth of the price. GPT-6 Luna does the searching.
- **Tuned for GPT-6.** The instructions:
  - spell out exactly what the architect may finish on its own (documents) and what it
    only proposes (code), because Codex leans towards acting;
  - say when to spawn `arch-scout`, because GPT-6 delegates less than you might want;
  - put the user's instructions above any skill;
  - ask it to name the file when a skill changes its behaviour;
  - ask for prose rather than lists, and set a stopping rule for gathering context.
- **No contradictions with AGENTS.md.** GPT-6 slows down when instructions conflict.
  Nothing in the root or `web/AGENTS.md` contradicts the role. Keep it that way when you
  edit any of them.
- **Read-only sandbox by default.** Reviews and questions cannot change anything. Writing
  an ADR needs one flag (`-s workspace-write`).
- **Cache-friendly.** The stable instructions come first, the question last. Keep the
  profile's model and effort fixed during a session.

## Steps

1. **Review the files** in this folder, especially `architect-instructions.md`.
2. **Copy them into place** from the repository root:
   ```bash
   mkdir -p .codex .agents && cp -R docs/ai-agents/it-architect/openai/.codex/. .codex/ && cp -R docs/ai-agents/it-architect/openai/.agents/. .agents/
   ```
   ```bash
   cp docs/ai-agents/it-architect/openai/review.schema.json .codex/
   ```
   ```bash
   cp docs/ai-agents/it-architect/openai/home/architect.config.toml ~/.codex/architect.config.toml
   ```
   ```bash
   chmod +x .agents/skills/architecture-review/scripts/fitness.sh
   ```
3. **Trust the project.** Codex reads a project's `.codex/` settings only when the project
   is trusted. Accept the prompt the first time Codex opens the repository, or set
   `projects."/Volumes/green/remis/dormantas/PPE-next2".trust_level = "trusted"` in
   `~/.codex/config.toml`.
4. **Check that it loads.** Run `codex -p architect`, then type `/skills`. Both skills
   should be listed. Then ask task 9 of `../evals.md`.
5. **Run the evaluation** in `../evals.md`, in the CLI or the desktop app. Fix the
   instructions or the checklist where the agent scores 0 or 1, then run it again.
6. **Commit** `.codex/` and `.agents/`. The profile stays in your home folder.

## How to use it

| You want | Do |
| --- | --- |
| A whole architecture session | `codex -p architect` (read-only) |
| Write an ADR or a spec | `codex -p architect -s workspace-write`, then `$adr outbox for cross-context reactions` |
| An architecture opinion inside normal coding work | In any Codex session or the desktop app: "ask the architect agent whether …" (`/subagents` switches to its thread) |
| Review the branch before merging | `codex -p architect`, then `$architecture-review` |
| A structured review for a script or CI | `codex exec -p architect --output-schema .codex/review.schema.json -o review.json "Use the architecture-review skill on the diff against main."` |
| Codex's built-in review, held to the architecture | `codex -p architect review --base main` (whether `review` accepts `-p` this way is not confirmed; if it does not, use the `exec` line above) |

## Optional: the OpenAI Agents SDK

Use this only for an architect that runs outside Codex, such as a bot or a scheduled job.
It needs more code, and you must sandbox its shell yourself, because the SDK's local
shell tools default to `needs_approval=False`.

```python
from pathlib import Path
from agents import Agent, Runner, ModelSettings, FileSearchTool
from openai.types.shared import Reasoning

architect = Agent(
    name="architect",
    instructions=Path(".codex/architect-instructions.md").read_text(),
    model="gpt-6-astra",
    model_settings=ModelSettings(reasoning=Reasoning(effort="high"), verbosity="medium"),
    # docs/ and the Go sources, uploaded once into a vector store (refresh on each deploy)
    tools=[FileSearchTool(vector_store_ids=["vs_..."], max_num_results=12)],
)
print(Runner.run_sync(architect, "Review ADR 0006 against ADR 0001 and the context map.").final_output)
```

File search answers from the files in the vector store, not from the live repository, so
it suits questions about the documents. Use Codex for reviews of code. Prompt caching is
automatic for a shared prefix of 1,024 tokens or more; the fixed instructions come first,
so repeated runs reuse it.

## Optional: no code at all (ChatGPT Project)

A ChatGPT Project holds instructions and files. Upload `architect-instructions.md` (as the
Project instructions), the context map, the ADRs, the domain-service contract and the
checklist. Plus and Go plans allow 25 files per project. The GitHub connector can only
read and search code. This is good for talking through decisions on a phone. It cannot
review a branch or write an ADR into the repository, and its files go stale.

## Keep it healthy

- Rerun `../evals.md` after any change to the instructions, the skills, the model or an
  AGENTS.md file.
- Keep the two skill copies (`.claude/skills` and `.agents/skills`) the same, apart from
  the script path. A symlink works if you prefer one copy:
  `ln -s ../../.agents/skills/adr .claude/skills/adr`. Then fix the script path in
  SKILL.md to match.
- When a new invariant lands, add a line to `checklist.md` and, if it applies to every
  task, to the Invariants section of `architect-instructions.md`.
