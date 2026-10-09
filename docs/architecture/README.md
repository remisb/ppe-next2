# Architecture

How the system is divided and why.

- [Context map](context-map.md): the bounded contexts, what each owns, and how they depend
  on each other.
- Architecture decision records (`adr/`), one decision each, numbered in order. A decision
  is changed by a new record that supersedes it, never by editing an accepted one.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](adr/0001-modular-monolith-with-bounded-contexts.md) | Bounded contexts in a modular monolith, one staff app of modules | proposed |
| [0002](adr/0002-permissions-and-administration-app.md) | Editable roles of permissions; Administration as its own app | accepted |
| [0003](adr/0003-audit-integrity-and-retention.md) | Security events apart from the audit trail; retention | accepted |
| [0004](adr/0004-company-assets.md) | Company Assets: individual items, one open assignment each; register-first UI | accepted |
