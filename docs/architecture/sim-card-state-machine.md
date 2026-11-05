# SIM card state machine

The states a SIM card goes through in Company Assets. A card has two facts that change
independently (asset-service.md, rule 2): its **connection status**, which is stored, and
**where it is and who holds it**, which is derived from its open assignment. No action
changes one as a side effect of the other: Change Status never moves a card, and giving or
returning never changes its status. Each assignment then has a lifecycle of its own, and a
signed copy may be added to it; the card's PIN and PUK, kept sealed, have one too. Built
from `internal/domain/asset` (`service.go`, `import.go`, `sim_scan.go`, `email.go`) and
`cmd/api/import-sims.go`; the rules behind each step are in
[asset-service.md](../specs/asset-service.md), the tables in
[sim-card-er-diagram.md](sim-card-er-diagram.md). The same diagrams as a page are
[sim-card-state-machine.html](sim-card-state-machine.html).

## Connection status

```mermaid
stateDiagram-v2
  direction LR
  state "Not Activated" as NOT_ACTIVATED
  state "Active" as ACTIVE
  state "Blocked" as BLOCKED
  [*] --> NOT_ACTIVATED : Add SIM (default), Scan SIMs, import "Not Activated"
  [*] --> ACTIVE : Add SIM (Active chosen), import "Active" or "Available"
  [*] --> BLOCKED : import "Blocked"
  NOT_ACTIVATED --> ACTIVE : Change Status
  ACTIVE --> NOT_ACTIVATED : Change Status
  ACTIVE --> BLOCKED : Change Status
  BLOCKED --> ACTIVE : Change Status (unblocked with the provider)
  NOT_ACTIVATED --> BLOCKED : Change Status
  BLOCKED --> NOT_ACTIVATED : Change Status
  note right of ACTIVE : Give SIM only in this status
  note left of NOT_ACTIVATED : Prepare Activation Email
```

| From | To | Trigger | Route | Notes |
| --- | --- | --- | --- | --- |
| — | Not Activated | Add SIM | `POST /api/v1/assets` | The default; `asset.registered` |
| — | Not Activated | Scan SIMs' Add | `POST /api/v1/assets/sim-cards/batch` | Every card of the batch, all or none; `asset.registered` each |
| — | Active | Add SIM with Active chosen | `POST /api/v1/assets` | For a card that arrives already active |
| — | any of the three | Go-live import | `api -import-sims` | Active and Available read as Active; Available with a holder is refused |
| any | any other | Change Status | `PUT /api/v1/assets/{id}/status` | `assets.manage`; saved at once with no confirmation step; `asset.status_changed` with the old and new status |
| any | the same | Change Status | as above | No-op: writes nothing |

`connection_status` is stored on `assets` and limited to the three values by a CHECK. There
is no final state: write-off is reserved (`written_off_at`) and not built, and no route
deletes a card. The status never stops a card being returned or marked Not Returned; it
matters only to Give SIM, which refuses anything but Active (409 `ErrNotActive`), and to
which provider emails the app offers. A Not Activated card is activated by its provider:
**Prepare Activation Email** (offered unless the card is Active, and beside a Not Activated
card's Change Status) prepares the request from the mail template `sim.activation`, and the
user sets Active by hand once the provider confirms. A card marked Not Returned is usually
then blocked: **Prepare Blocking Email** (offered unless the card is Blocked) prepares it from
`sim.blocking`, and the user sets Blocked the same way. Neither email is sent by the app or
changes the status (`GET /api/v1/assets/{id}/emails/{kind}`); its copy is recorded. A
returned blocked card must be unblocked and set Active before it can be given again.

## Where the card is

```mermaid
stateDiagram-v2
  direction TB
  state "In the Office" as Office
  state "With an employee" as Held
  state "Not Returned, still with the employee" as NRWith
  state "Not Returned, whereabouts unknown" as NRUnknown
  [*] --> Office : Add SIM, Scan SIMs, import without a holder
  [*] --> Held : import with a holder (no form)
  Office --> Held : Give SIM (Active, value, signed form)
  Held --> NRWith : Mark as Not Returned (WITH_EMPLOYEE)
  Held --> NRUnknown : Mark as Not Returned (UNKNOWN)
  Held --> Office : Register Return
  NRWith --> Office : Register Return
  NRUnknown --> Office : Register Return
```

| From | To | Trigger | Route | Notes |
| --- | --- | --- | --- | --- |
| — | In the Office | Add SIM, Scan SIMs' Add, or import with no holder | `POST /api/v1/assets`, `POST /api/v1/assets/sim-cards/batch`, `api -import-sims` | No assignment |
| — | With an employee | Import with a holder | `api -import-sims` | Given on the import's day with no form; `asset.registered` and `asset.given` with no document hash |
| In the Office | With an employee | Give SIM | `POST /api/v1/assets/{id}/assignments` | See the checks below; `asset.given`, and `asset.updated` first when a missing plan or value was filled in |
| With an employee | Not Returned, with the employee or unknown | Mark as Not Returned | `POST /api/v1/assets/{id}/not-returned` | The card stays with its holder and out of office stock; `asset.marked_not_returned` |
| any held state | In the Office | Register Return | `POST /api/v1/assets/{id}/return` | Return date not before the given date or in the future; `asset.returned`. The status, the Not Returned mark, the form and the signed copies stay |

Location is derived, never stored: **Office** with no open assignment, **With Employee**
with one, **Unknown** when that one is marked Not Returned with whereabouts `UNKNOWN`. The
holder is the open assignment's employee, in every held state. Only Register Return brings a
card back: not an employee leaving, not the Not Returned mark, not Blocked.

Give SIM runs in one transaction with the card locked `FOR UPDATE` and the employee
`FOR SHARE`, and answers the first check that fails:

| Check | Answer |
| --- | --- |
| The card is live | 404 |
| The employee is live | 404 `ErrEmployeeNotFound` |
| No open assignment | 409 `ErrAlreadyGiven` |
| Status Active | 409 `ErrNotActive` |
| A Non-return Value (the phone number and plan may be blank) | 400 |
| Given date not in the future | 400 |
| Paper Form Signed ticked | 400 |
| The printed form's hash equals the form built now | 409 `ErrFormChanged` |

Refused moves: Give SIM on a held card is 409 `ErrAlreadyGiven`; Register Return or Mark as
Not Returned on a card in the Office is 409 `ErrNotGiven`; marking a card already marked is
409 `ErrAlreadyMarked`, so whereabouts cannot be changed (open decision 7). A partial unique
index allows one open assignment per card, so two people giving it at once cannot both
succeed.

## Assignment

```mermaid
stateDiagram-v2
  direction LR
  state "Open" as Open
  state "Open, marked Not Returned" as Marked
  state "Returned" as Returned
  [*] --> Open : Give SIM, import with a holder
  Open --> Marked : Mark as Not Returned
  Open --> Returned : Register Return
  Marked --> Returned : Register Return (the mark stays)
  Returned --> [*]
```

| State | Stored as |
| --- | --- |
| Open | `returned_date` null, `not_returned_at` null |
| Open, marked Not Returned | `returned_date` null; `not_returned_at`, `not_returned_by_user_id`, `not_returned_comment` and `whereabouts` set |
| Returned | `returned_date`, `returned_at`, `returned_by_user_id` and `return_comment` set |

An assignment is never deleted, its giving (employee, date, form, hash) never changes, the
mark is set once and a returned assignment is closed: the trigger `asset_assignments_guard`
refuses anything else, and `ppe_app` has no DELETE on the table. A card's earlier
assignments are its history; a new giving is a new assignment.

## Signed copy

```mermaid
stateDiagram-v2
  direction LR
  state "No form (imported)" as NoForm
  state "Signed Copy Missing" as Missing
  state "Signed Copy Uploaded" as Uploaded
  [*] --> Missing : Give SIM (form stored)
  [*] --> NoForm : import with a holder
  Missing --> Uploaded : Upload Signed Form
  Uploaded --> Uploaded : Upload again (adds a copy)
  NoForm --> NoForm : Print Form (built when printed, not stored)
```

| From | To | Trigger | Route | Notes |
| --- | --- | --- | --- | --- |
| Signed Copy Missing | Signed Copy Uploaded | Upload Signed Form | `POST /api/v1/assets/{id}/assignments/{assignmentID}/signed-copies` | PDF, JPEG or PNG up to 10 MB; `asset.signed_copy_uploaded`. Allowed while open and after the return |
| Signed Copy Uploaded | Signed Copy Uploaded | Upload again | as above | Adds a row; the newest is shown, the earlier ones stay (`asset_signed_copies` is append-only) |
| No form | No form | Print Form, while the card is still held | `GET …/assignments/{assignmentID}/form`, recorded by `POST …/assignments/{assignmentID}/form-printed` | A form built from the card and holder as they are then, dated `asset.ImportedFormDate` and never stored; `asset.form_printed`. Needs the Non-return Value. No signed copy can be uploaded (404 `ErrNoForm`) |

The register's Documents column and its `signed_copy=missing` filter show the first two
states for the cards held on a form. Printing a form, again or for the first time, is
recorded (`asset.form_printed`) but changes no state, and so is copying or sending a provider
email (`asset.activation_email_prepared`, `asset.blocking_email_prepared`,
`POST /api/v1/assets/{id}/emails/{kind}/copied`).

## PIN and PUK

```mermaid
stateDiagram-v2
  direction LR
  state "No PIN and PUK" as None
  state "PIN and PUK kept (sealed)" as Kept
  [*] --> None : Add SIM, import, Scan SIMs without the back
  [*] --> Kept : Scan SIMs with the back read
  None --> Kept : Add PIN and PUK
  Kept --> Kept : Set again (replaces them)
  Kept --> None : Clear
  note right of Kept : Show PIN and PUK, recorded
```

| From | To | Trigger | Route | Notes |
| --- | --- | --- | --- | --- |
| — | PIN and PUK kept | Scan SIMs' Add, a card whose back was read | `POST /api/v1/assets/sim-cards/batch` | Both or neither; sealed in the same transaction as the card; `asset.registered` says `"sim_codes": "set"` |
| No PIN and PUK | PIN and PUK kept | Add PIN and PUK | `PUT /api/v1/assets/{id}/sim-codes` | `assets.manage`; PIN 4 to 8 digits, PUK 8; `asset.sim_codes_changed` `{"sim_codes": "set"}` |
| PIN and PUK kept | PIN and PUK kept | Set again | as above | Replaces them; the same event |
| PIN and PUK kept | No PIN and PUK | Clear | `DELETE /api/v1/assets/{id}/sim-codes` | `asset.sim_codes_changed` `{"sim_codes": "cleared"}`; 404 `ErrNoSIMCodes` with none |
| PIN and PUK kept | PIN and PUK kept | Show PIN and PUK | `POST /api/v1/assets/{id}/sim-codes/show` | `sim_codes.read` and a recent sign-in; records `asset.sim_codes_shown` before answering, `no-store`; changes nothing. 404 with none, recording nothing |

The state is whether the card has a row in `asset_sim_codes`: the PIN and PUK sealed together
(AES-256-GCM under `API_SIM_CODES_KEY`), bound to the card's id. No event, error or log line
ever holds them. They are independent of the other three: giving, returning, Not Returned
and every status keep them as they are. Only SIM cards have them; the go-live import and
Add SIM bring none.
