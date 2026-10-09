# Company Assets UX Review

How the assets brief (`../PPE-documents/GAVORT_SIM_ir_inventoriaus_apskaitos_uzduotis.pdf`,
v1.0, 2026-10-08) fits PPE-next2, and how its screens should work. The interactive version,
with mockups, the step table, scoring and a working Give SIM Card form, is
[company-assets-ux-review.html](company-assets-ux-review.html).

9 Oct 2026 · reviewed build `4fc207e` · sample data · status: **option R chosen**; decision
in [ADR 0004](../architecture/adr/0004-company-assets.md), rules in
[asset-service.md](../specs/asset-service.md), terms in
[ubiquitous-language.md §12](../ubiquitous-language.md#12-company-assets).

## Fit

The brief has 36 requirements: 5 reuse the app as it is, 14 extend an existing pattern,
14 are new and 3 are open.

- **Carries over:** employees and the employee picker; permissions; audited `Mutation`
  repositories, which already make one action update everything or nothing; immutable
  snapshots with a document hash; A4 print; Form sheet, `Table stack`, summary tiles,
  ⌘K Search, Changes; the organisation timezone.
- **Missing:** individual items, return, location and office stock; file upload and
  storage; an employee's "no longer working" state; company details and provider contacts
  in Settings.
- **Words:** "History" is on the avoid list (an asset has Assignments and Changes); "Given"
  is the order status; "received" means Given except for a SIM's Received Date; "Hand-over
  mode" is workwear's, so one giving of an asset is an **assignment**, and its paper is the
  **assignment form**, never a record or receipt.

## Rules model

Three facts change on their own: the **connection status** (Not Activated, Active,
Blocked; only Change Status), the **assignment** (Give opens one, Register Return closes
it, Mark as Not Returned marks it), and the **location**, which follows from the
assignment. Give needs an asset in the Office with no holder, an Active SIM, complete form
data, and Paper Form Signed. The summary tiles overlap and are never added up.

## Options

| | Idea | Desktop steps | Pros | Cons |
| --- | --- | --- | --- | --- |
| A · Register + action sheets | List-first like Orders; tiles filter; each row offers the action its state allows; Form sheets over the list | 45 | Familiar; reuses the most; wrong actions never shown | Wide table must stack on phones; secondary actions in ⋯ |
| B · Item page hub | List only finds; actions, assignments and documents on the asset's page | 49 | Best on phones; shows the three facts plainly | One more tap per action; batch office work is slow |
| C · Employee-first | Employee page "Items held" with Give…; ⌘K takes numbers and offers actions | 45 | Matches a person at the desk; fast with a keyboard | Office work has no home; palette actions hard to find |
| D · Inline grid | Status, holder and flags edited in cells | 45 | Fewest clicks for desk work | Print and signature gates cannot live in a cell; accidental edits with no confirmation; fails on phones |
| **R · A + B + C (chosen)** | A's register and sheets; B's asset page; C's employee page and ⌘K; the next step offered after an action | **43** | Fewest steps; every §6 gate; each part reuses a pattern | Three entry points to document and test |

Steps count each tap and each required entry, over nine actions: Add SIM Card, Change
Status, Give from the employee, Give from the register, Register Return, Mark as Not
Returned with the blocking email, Upload Signed Form, find the blocked cards in the office,
and open an asset's history. On a phone, Company Assets and Search sit under More (one tap
more).

## Chosen design (R)

- **Navigation:** Company Assets after Employees in the sidebar and rail; under More on
  phones (P1), with a Company Assets card of the four tiles on the dashboards (P2).
- **Register:** tabs SIM Cards and Equipment & Furniture; tiles Total SIM Cards, In Office,
  With Employees, Not Returned as filters; search by SIM No., Phone No., Inventory No. or
  employee; chips for the three statuses, Not Returned and Signed Copy Missing. Each row
  has one primary action (Give, Return or Change Status) and ⋯ for the others.
- **Actions:** every action is a Form sheet with defaults filled in and no confirmation
  window. Give shows only office cards, and lists Not Activated and Blocked cards greyed out
  with the reason. Changing the form after Print Form clears Paper Form Signed. After Mark
  as Not Returned the notice offers Prepare Blocking Email; a Not Activated card shows the
  provider's e-mail.
- **Asset page:** the numbers with copy buttons; three blocks for Connection, Where and
  Held by; the primary action; Assignments (each with its form and signed copy); Changes.
- **Employee page:** Given SIM and Equipment sections beside Items given, each with Give.
- **⌘K Search:** finds assets by any of their numbers.
