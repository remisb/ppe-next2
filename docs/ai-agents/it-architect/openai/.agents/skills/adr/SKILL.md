---
name: adr
description: >-
  Write or supersede an architecture decision record for PPE-next2 in the house format,
  numbered in order and added to the index. Use when a structural decision is made or
  proposed: a new context, app, service, table family, permission model, external
  dependency, security or data-protection rule, or a change to an earlier decision.
---

# Architecture decision record

1. **Number.** `ls docs/architecture/adr/` and take the next four-digit number. The file is
   `docs/architecture/adr/NNNN-<short-kebab-title>.md`.
2. **Read first.** The ADRs it builds on or supersedes, `docs/architecture/context-map.md`,
   and the spec of every service it touches. Check the terms in
   `docs/ubiquitous-language.md`.
3. **Never edit an accepted ADR's decision.** A changed decision is a new ADR with
   `Supersedes:`; the old one gets only a status line pointing to the new one
   (`superseded by NNNN`), and only once the new one is accepted.
4. **Write it** from [template.md](template.md). Status starts as `proposed`. Facts in
   Context carry their source (file, document section, measurement). Options considered is
   a table with the chosen column in bold. Consequences list the code, migrations, tests and
   documents that change. Plan gives slices that are each usable alone.
5. **Index.** Add the row to the table in `docs/architecture/README.md`, and update
   `docs/architecture/context-map.md` when contexts or relationships change.
6. **Check.** `sh .agents/skills/architecture-review/scripts/fitness.sh` (the ADR index
   check), then give the user the path, the decision in two sentences and the open
   questions.

Style: plain, short sentences in the project's words. One decision per record. No
marketing words, no hedging; say what is decided and what is not.
