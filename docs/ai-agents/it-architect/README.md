# IT architect agent: proposal and setup

A draft for review. Nothing here is installed: every file sits in this folder, laid out
as it would sit in the repository, and each platform's `SETUP.md` gives the copy commands.

## The role

The architect owns the shape of PPE-next2, not its features. It:

1. **Decides and records.** It turns a structural question into options and a
   recommendation, and writes the ADR once you agree.
2. **Reviews.** It checks plans, branches and diffs against this repository's invariants
   (contexts, the domain-service contract, data and security rules, route policy, CSP,
   documents).
3. **Guards boundaries, data and security,** including the HR data-protection rules ADR
   0001 sets before Personnel files and Competence are built.
4. **Keeps the architecture documents true.** It says when code and a document disagree,
   and which one is right.
5. **Keeps a short risk and debt list,** each item with the action that retires it.

It designs and reviews. It writes only architecture and developer documents. For code it
proposes the files, the change and the tests. It never touches secrets, databases,
deploys or git history; on Claude a hook enforces this, on Codex the read-only sandbox does.

## What the review of the project found

These facts shaped the prompts. Several are also the architect's first jobs.

| Finding | Where | What it means for the agent |
| --- | --- | --- |
| The architecture is well documented: a context map, 6 ADRs, a binding domain-service contract, 16 service specs, ER and state diagrams, a glossary | `docs/` | The prompt stays small and points to these files instead of repeating them |
| ADR 0001 (modular monolith) and ADR 0006 (App Launcher) are still **proposed**, and so is the context map | `docs/architecture/README.md` | The first decisions for the architect to drive |
| "No domain package imports another" is not quite true: `catalogue`, `employee` and `order` import `size`; `dashboard` imports `catalogue`, `order` and `size`; `user` imports `role` | `go list ./internal/domain/...` | Each pair looks justified (a value vocabulary, the reporting read model, IAM). Nothing enforces the rule, though: ADR 0001 item 2's import test does not exist. `fitness.sh` covers the gap with a judged allow-list until that test exists |
| Access tokens are still HS256 with a shared secret | `cmd/api/auth.go:73` | ADR 0001 item 7 (EdDSA) must land before any extraction; it is on the risk list |
| `@ppe/api-client` is written by hand | CLAUDE.md, ADR 0001 Frontend | A drift risk ADR 0001 wants solved by generated types |
| No frontend lint enforces module boundaries | `web/` has no ESLint config | Boundaries rely on review |
| CLAUDE.md is 35 KB and mostly a status log | `CLAUDE.md` | Every Claude session and subagent loads it, which costs tokens. It is also over Codex's 32 KiB AGENTS.md limit, so the OpenAI setup carries its own compact context |
| The root `AGENTS.md` is a 209-byte stub, with one heading repeated | `AGENTS.md` | Codex learns almost nothing from it. The architect does not depend on it |
| One droplet, one developer, in-process jobs (with an advisory lock), Spaces files outside the database backups, an offline key (`API_SIM_CODES_KEY`) | CLAUDE.md, `docs/backups.md` | The operational risks the architect weighs |

Recommended follow-ups, outside this proposal:

- Move CLAUDE.md's long Status paragraph to `docs/status.md` and keep CLAUDE.md to rules
  and commands. Every session would get cheaper.
- Write a real root `AGENTS.md` (5 to 10 KB) that both tools read.
- Have the architect, once installed, write the ADR for the import-boundary test.

## The two setups

| | Claude (Claude Code) | OpenAI (Codex) |
| --- | --- | --- |
| Form | Subagent `.claude/agents/architect.md`; whole session with `claude --agent architect` | Profile `~/.codex/architect.config.toml` (`codex -p architect`) plus a subagent `.codex/agents/architect.toml` |
| Model | Opus 5.5, effort `high` (`xhigh` or Fable 5.1 for the hardest decisions) | GPT-6 Astra, effort `high` (`xhigh` for hard ones; `gpt-6.1-sol` at medium for cheap questions) |
| Cheap searcher | `arch-scout` on Haiku 5.5, does not load CLAUDE.md | `arch-scout` on GPT-6 Luna |
| Project knowledge | CLAUDE.md loads by itself; the prompt holds the role and a document map | AGENTS.md is a stub and CLAUDE.md is not read, so the instructions carry the map and the key invariants |
| Procedures | Skills `architecture-review`, `adr` in `.claude/skills`, preloaded into the subagent | The same skills in `.agents/skills`, run with `$architecture-review`, `$adr` |
| Limits | A frontmatter hook (writes to docs only; no push, migrate, deploy or secrets) and deny rules in settings | Read-only sandbox by default, `-s workspace-write` for ADRs, and the instructions |
| Prompt style | Role sentence, XML-tagged sections, a reason with each rule, a rule against over-delegating | Identity, Instructions, Examples, Context; what it may finish on its own; when to delegate (GPT-6 delegates too little); prose over lists |
| Unattended runs | `claude -p --agent architect`, Agent SDK | `codex exec --output-schema`, `codex review`, Agents SDK |

Both share `evals.md`, the checklist and `fitness.sh`, so you can compare them on the same
tasks.

## Files

```
README.md                  this page
evals.md                   12 graded tasks and behaviour checks, for both platforms
claude/SETUP.md            Claude steps, reasons, usage, Agent SDK option
claude/settings.snippet.json
claude/.claude/agents/{architect,arch-scout}.md
claude/.claude/skills/architecture-review/{SKILL.md,checklist.md,scripts/fitness.sh}
claude/.claude/skills/adr/{SKILL.md,template.md}
claude/.claude/hooks/architect-guard.sh
openai/SETUP.md            Codex steps, reasons, usage, Agents SDK and ChatGPT options
openai/.codex/architect-instructions.md
openai/.codex/agents/{architect,arch-scout}.toml
openai/.agents/skills/…    the same two skills, paths adjusted
openai/home/architect.config.toml   the profile, for ~/.codex/
openai/review.schema.json
```

## Suggested order

1. Read the two prompts (`claude/.claude/agents/architect.md`,
   `openai/.codex/architect-instructions.md`) and `checklist.md`. Change the role where it
   is not what you want.
2. Install one platform (its `SETUP.md`) and run `evals.md`. Then the other.
3. Compare the scores, time and cost. Keep one platform as the main one, or both, for a
   second opinion on big decisions.
4. Give it the first real job: decide ADR 0001 (still proposed).

## What was checked and what was not

- `fitness.sh` was run on this repository and passes. It catches a disallowed import, and
  the guard hook was tested with four inputs (push blocked, `go list` allowed, a code edit
  blocked, a spec edit allowed). The TOML and JSON files parse.
- Neither agent has been installed or run. The platform facts come from the official docs
  as of 2026-10-31. Two are not confirmed: whether `codex review` accepts `-p`, and whether
  the Claude Agent SDK's `settingSources` also loads `.claude/agents/`. The SETUP pages say
  so where they matter.
