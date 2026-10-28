# Architecture

How the system is divided and why.

- [Context map](context-map.md): the bounded contexts, what each owns, and how they depend
  on each other.
- [Order ER diagram](order-er-diagram.md) (and [`.html`](order-er-diagram.html)): the Order
  aggregate's tables, their keys and the constraints the diagram cannot show.
- [Order state machine](order-state-machine.md) (and [`.html`](order-state-machine.html)): an
  order's statuses and transitions, and the confirmation link's lifecycle.
- [SIM Card ER diagram](sim-card-er-diagram.md) (and [`.html`](sim-card-er-diagram.html)): a
  SIM card's tables in Company Assets, with its assignments, signed copies, numbers and the
  Settings defaults, and the constraints the diagram cannot show.
- [Equipment ER diagram](equipment-er-diagram.md) (and [`.html`](equipment-er-diagram.html)):
  the same tables for Equipment & Furniture, with the role that lets a user see them.
- [SIM card state machine](sim-card-state-machine.md) (and
  [`.html`](sim-card-state-machine.html)): a card's connection status and where
  it is, which change independently, and the lifecycles of its assignments and signed copies.
- Architecture decision records (`adr/`), one decision each, numbered in order. A decision
  is changed by a new record that supersedes it, never by editing an accepted one.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](adr/0001-modular-monolith-with-bounded-contexts.md) | Bounded contexts in a modular monolith, one staff app of modules | proposed |
| [0002](adr/0002-permissions-and-administration-app.md) | Editable roles of permissions; Administration as its own app | accepted |
| [0003](adr/0003-audit-integrity-and-retention.md) | Security events apart from the audit trail; retention | accepted |
| [0004](adr/0004-company-assets.md) | Company Assets: individual items, one open assignment each; register-first UI | accepted |
