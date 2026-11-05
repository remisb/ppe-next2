# ADR NNNN: <Decision, as a short sentence>

- **Status:** proposed
- **Date:** YYYY-MM-DD
- **Scope:** backend (Go API, Postgres) | frontend (`web/…`) | deployment | files
- **Builds on:** [ADR XXXX](XXXX-….md) (which item)
- **Supersedes:** (only when it does)

## Context

What has to be decided and why now. The facts that bear on it, each with its source.
The constraints: one droplet, one developer, the product contract, data protection.

## Decision

1. **<Decision in bold.>** The rule, then the reason in one or two sentences.
2. …

## Options considered

| | Option A | **Option B (chosen)** | Option C |
| --- | --- | --- | --- |
| Transactions and invariants | | | |
| Security and data protection | | | |
| Operations | | | |
| Cost of change | | | |

## Consequences

- Code, migrations and grants that change.
- Tests: the route policy, Postgres tests, e2e, `docs/testing.md`.
- Documents: specs, context map, glossary, `web/AGENTS.md`, `CLAUDE.md`.
- What becomes harder, and the trigger that would make us revisit this.

## Plan

Slices, each usable alone: 1 …; 2 …
