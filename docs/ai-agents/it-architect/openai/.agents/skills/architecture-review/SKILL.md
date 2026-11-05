---
name: architecture-review
description: >-
  Review a plan, branch, diff or pull request of PPE-next2 against its architecture:
  bounded contexts, the domain-service contract, data and security invariants, the route
  policy, the frontend rules and the documents that must change with it. Use when asked
  to review a design or change for architecture, before merging a structural change, or
  when a change adds a table, route, permission, app, context or external dependency.
---

# Architecture review

## 1. Find what changed

- No argument: `git diff main...HEAD --stat` plus `git status --short`.
- A branch: `git diff main...<branch> --stat`. A PR: `gh pr diff <n> --name-only`.
- A plan or document: read it, then find the code it would touch.

Group the files by area: migrations, `internal/domain/*`, `cmd/api`, other `internal/*`,
`web/apps/*`, `web/packages/*`, `deploy/` and compose files, `docs/`.

## 2. Run the mechanical checks

```sh
sh .agents/skills/architecture-review/scripts/fitness.sh
```

It checks domain imports against a judged allow-list, transport imports in domain
packages, migration pairs and numbering, and the ADR index. Report its findings as they
are; a new import pair is a finding until someone gives the reason.

## 3. Walk the checklist

Read [checklist.md](checklist.md) and apply only the sections whose area changed. For each
item that applies, open the code that proves it holds or not. Do not report an item you
did not check.

## 4. Report

```
Verdict: ready | ready after the fixes below | needs a decision first

Must fix (breaks an invariant or a binding rule)
- path:line — what is wrong — the rule (document and section) — the fix

Should fix (drift, missing test or document)
- ...

Decisions to record
- the structural choice this change makes, and whether it needs an ADR

Checked and fine
- one line per checklist section applied
```

Keep findings concrete and few. A finding without a file and a rule is not a finding.
