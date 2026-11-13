# Employee service

People workwear is ordered for, and their reusable size defaults. Package
`internal/domain/employee`, routes in `cmd/api/employee-routes.go`, table from migration
`0003_employees` (clothing size made numeric by `0012_numeric_clothing_size`, preferred
language added by `0017_employee_language`, access split into profile and sizes by 0050,
`merged_into_id` and `employee_distinct_pairs` added by 0052). Manual §3.2
and §4.1.

## Entity

| Field | Notes |
| --- | --- |
| `first_name`, `last_name` | Required (Add New Employee needs nothing else) |
| `code` | Optional; unique among live employees, case-insensitive |
| `height_cm` | Optional, 100–250; used only to *suggest* a clothing size |
| `clothing_size` | Optional EU size, a JSON number: even, 44–66 (else 400 "is not a known clothing size"; a string is refused) |
| `shoe_size` | Optional: 39–46 |
| `notes` | Optional free text |
| `preferred_language` | Optional: `en`, `lt` or `ru`, the languages the app speaks (else 400); `null` when not recorded. A CHECK in migration `0017_employee_language` holds it too. Update replaces every field, so a PUT without it clears it. The confirmation page and hand-over mode open in it when it is `en` or `ru` (order records carry it as `employee_language`) |
| `birth_date`, `nationality`, `sex` | Response only, `null` until an identity document saved with Add to Employee Record fills them (Personnel files, [personnel-service.md](personnel-service.md); migration 0048). The employee's routes never accept or change them |
| `full_name` | Derived, response only |

There is no glove size: gloves and similar PPE are no-size items.

Sizes are **defaults for future orders**. Orders snapshot the size they used, so editing an
employee never alters an existing order.

Clothing sizes were letters (S … 3XL) until migration 0012, which converted saved sizes
S→46, M→50, L→54, XL→58, 2XL→62, 3XL→66. Order lines are immutable and keep the letters
they were ordered in; new lines hold the number as a string code (`"54"`). Audit events
written before 0012 likewise keep `clothing_size` as a letter string.

## Access

An employee's **name** is every signed-in user's: Create Order, Orders, search and the
dashboards need it. The rest has two pairs of permissions (migration 0050):

- **Profile**: the code, notes, preferred language, photos, and the birth date, nationality
  and sex from an identity document. Seen with `employee_profiles.read` (**See employee
  profiles**); Add New Employee, Edit (name, code, notes, language) and the photos' changes
  take `employee_profiles.manage` (**Manage employee profiles**, which needs it).
- **Sizes**: height, clothing and shoe size. Seen with `employee_sizes.read` (**See employee
  sizes**); Edit Sizes, Create Order's Save as Employee Default and the sizes on Add and Edit
  take `employee_sizes.manage` (**Manage employee sizes**, which needs it).

Without a read permission its fields are blank (`null`, notes `""`) in every employee the API
answers, as if never recorded (`employee.Sight`, decided in `cmd/api` from the token), and
the employee's Changes leave them out: no `employee.sizes_changed` and no sizes on
`employee.created` without Sizes; without Profile no code, language or notes in
`employee.updated` (an event left with nothing is left out) and no `employee.photo_*`.
Personnel files' own events (`personnel.*`) are theirs to decide. Create Order still resolves
lines from the size defaults on the server; the lines' sizes are the order's. Without
`employee_sizes.manage`, Add New Employee starts with no sizes and Edit keeps the sizes as they
are, whatever the body says (`employee.Rights`; the writer may not even see them). The
Assigned to search still matches a code. The migration kept every role's access: all four for
every role but the add-on roles Equipment Assignments, Testers and Personnel Documents.

## Routes

| Route | Access | Kind |
| --- | --- | --- |
| `GET /api/v1/employees` | any authenticated | list, each as the reader may see it |
| `GET /api/v1/employees/{id}` | any authenticated | 404 on miss; as the reader may see it |
| `GET /api/v1/employees/by-name/{q}` | any authenticated | **filter** (the employee picker's search, ⌘K, Import Documents' person step): matches first, last, full name or code, case-insensitive substring, max 50; no match is `200 []` |
| `POST /api/v1/employees` | `employee_profiles.manage` | body: all entity fields except derived; the sizes only with `employee_sizes.manage` |
| `PUT /api/v1/employees/{id}` | `employee_profiles.manage` | full replace of the same body; the sizes kept without `employee_sizes.manage` |
| `PUT /api/v1/employees/{id}/sizes` | `employee_sizes.manage` | Edit Sizes / the **Save** button of Create Order's size pop-up (`item-set-service.md`): `{height_cm, clothing_size, shoe_size}`, all three replaced |
| `DELETE /api/v1/employees/{id}` | `employees.delete` | soft delete; 409 (`employee.ErrHoldsAssets`, naming them) while they hold company assets, checked under the employee's row lock, which giving an asset share-locks |
| `POST /api/v1/employees/similar` | `employee_profiles.manage` | Add New Employee's check (and Merge with…'s, which passes the employee being merged as `except_id`), body `{first_name, last_name, except_id?}` (names in the body, out of the address and logs): `[{employee, kind}]`, at most 5, `same_name` first |
| `GET /api/v1/employees/possible-duplicates` | `employees.merge` | `[{a, b, kind}]`, the older record as `a`; pairs marked Not the Same Person left out |
| `POST /api/v1/employees/distinct-pairs` | `employees.merge` | Not the Same Person, `{employee_a, employee_b}`; 204, again changes nothing |
| `GET /api/v1/employees/{id}/merge/{remove}` | `employees.merge` | Merge Employees' review: `{keep, remove, contents}` |
| `POST /api/v1/employees/{id}/merge/{remove}` | `employees.merge` | Merge Employees: the record kept as chosen (the Edit body); answers with it |

A read of a record merged into another (`GET /employees/{id}`, its Changes) is a 404 whose
`existing_id` is the record kept; the app opens that one. Adding or editing with a code a live
employee has is a 409 whose `existing_id` is that employee.

## Audit

`employee.created` (after = sizes), `employee.updated` (the changed first and last name, code
and preferred language before/after, and `notes_changed: true` when the notes changed, never
their text), `employee.sizes_changed` (before/after sizes, only when a size default actually
changes, from either PUT), `employee.deleted`; `employee.merged`, `employee.merged_away`,
`employee.marked_distinct` and, on orders, `order.employee_merged` (Duplicates and merging). One PUT that changes both details and sizes
records both events. Each is written in the same transaction as the change, from the row read
under `FOR UPDATE`. They read on the Audit log and the employee's Changes
([audit-service.md](audit-service.md)).

## Duplicates and merging

One person entered twice (production, 2026-11: "Abhijith Palanil Sajeevan" and "PALANJIL
SAJEEVAN ABHIJITH") is caught when adding, found among the employees already there, and made
one record by Merge Employees (migration 0052).

**Alike names** (`employee.CompareNames`, `similar.go`). Each name's words are folded as an
identity document's MRZ holds them (`mrz.Fold`: no accents, Cyrillic transliterated, upper
case), first and last name together. **Same name** (`same_name`): the same words in any order.
**Similar name** (`similar_name`): at least two words match and they are at least two thirds of
the longer name's words (two common words, as "Mohammad" and "Islam" in two four-word names, are not enough); a word of 4 letters or more may differ from its match by one letter
(added, left out, changed, or two swapped), of 7 or more by two, and shorter words must be
equal. "Jonas Jonaitis" and "Jonas Jonaitienė" are two people; a married surname is not a slip.
Names are compared in Go over the live employees: no index serves them.

**Add New Employee** (`employee-form.tsx`) asks `similar` once both names are typed (400 ms
after the last key) and shows **This person may already be an employee** with each match, its
kind and facts, and **Use This Employee**: the Employees screen opens them, Create Order selects
them for the order. Save then reads **Add as New Employee**: a warning only, never a refusal. A
code already in use answers 409 with the employee, shown the same way.

**Possible duplicates.** Whoever holds `employees.merge` sees, above the Employees list, the
first pair that may be one person, how many more, **Review** (Merge Employees on the pair) and
**Not the Same Person** (`employee_distinct_pairs`, the pair stored smaller id first, an
`employee.marked_distinct` event on each; it is never offered again).

**Merge Employees** (`employees.merge`, Administrator and Manager; it needs
`employee_profiles.manage` and `employee_sizes.manage`), from Review or an employee's ⋯
**Merge with…** (the second record picked, names like this one's offered first). The review
(`merge-employees-sheet.tsx`, rules in `lib/merge-employees.ts`) chooses the record kept (the
older by default) and, row by row, whose name, code, height, clothing and shoe size and language
it takes (the kept one's unless it has none); notes are both kept, one after the other. It says
what moves: orders, company assets (held now or returned), photos and Changes. Merge asks first.
In one transaction, both rows locked `FOR UPDATE` in id order (giving an asset and Mark as
Ordered share-lock the employee, so neither passes a merge):

- the record removed is soft-deleted with `merged_into_id` = the one kept (and records merged
  into it before now point at the one kept); it goes first, so the one kept may take its code;
- its orders, deleted ones included, move (`orders.employee_id`); their snapshots, receipts and
  hashes keep the name they were made with (`employee_id` is in no hash), and each gets
  `order.employee_merged` (before/after `employee_id`);
- its company assets' assignments, open and returned, move: `asset_assignments_guard` allows a
  change of `employee_id` only under `SET LOCAL ppe.employee_merge = on`, set for that one
  statement; the signed form keeps its name and hash, and the asset now names the one kept;
- its photos move, no longer the default when the one kept has one;
- its Not the Same Person marks go; `ai_usage` and the audit trail stay as they are (append-only);
- the one kept is written with the chosen values; `employee.merged` on it (the fields changed,
  as `employee.updated` and `employee.sizes_changed` record them, the record merged in, and the
  ids of what moved) and `employee.merged_away` on the one removed (`merged_into_id`).

A record with identity documents (`personnel.subjects`) cannot be the one removed: its data key
is sealed to its id (ADR 0007), so it is kept (the review chooses it and says why), and when both
have documents the merge is refused (409, `employee.ErrMergePersonnel`). The kept employee's
Changes include the removed record's (`audit.Query.MergedIDs`); `employee.merged` shows only the
fields the reader may see (`employee.Sight`). A merge is not undone in the app.

## Photos

An employee has any number of photos (`internal/domain/employeephoto`, migration 0037,
`employee_photos`): a JPEG or PNG of at most 10 MB, its metadata removed but for orientation,
kept in the files store (`API_FILES_TARGET`) under `employee-photos/<employee>/<photo>`.

- **Default.** At most one photo per employee is the default (a partial unique index). The
  first photo added becomes it; Make Default moves it; removing the default makes the oldest
  remaining photo the default. `Employee.default_photo_id` carries it to the lists' avatars.
- **Uses.** Each photo has none, one or several uses from a fixed list: `profile`, `id_badge`,
  `sizing`, `receipt` (`PHOTO_USES` in `@ppe/api-client`). They are optional and replaced as a set.
- **Removal** is a soft delete; the file stays in the store.
- **Access.** The employee's profile: seen (the list and the picture) with
  `employee_profiles.read`; added, their uses, the default and removal with
  `employee_profiles.manage`. Import Documents adds a document's portrait as a photo, so adding
  one also takes `personnel.documents.manage` (ADR 0007; `router.restrictedAny`).
- **Routes**, under `/api/v1/employee-photos/{employee id}` (under `/employees/{id}/…` they would
  clash with `/employees/by-name/{q}`): `GET` lists (default first); `POST` multipart `file` and
  any number of `uses`; `GET …/{photo}` the picture; `PUT …/{photo}` `{"uses": [...]}`;
  `PUT …/{photo}/default`; `DELETE …/{photo}`. 413 too large, 415 not JPEG/PNG, 503 no storage.
- **Audit** (on the employee): `employee.photo_added`, `photo_uses_changed`,
  `photo_default_changed`, `photo_removed`.
- **Adding by drag and drop** (web, `lib/photo-drop.ts`): JPEG or PNG files dropped on an
  employee's row in the Employees list, anywhere on the open employee, or on the Photos section
  are added as that employee's photos (several at once, one after another; a file that is not a
  photo refuses the whole drop before anything is sent). Add Photo also takes several files.
- The web shows photos in an employee's Photos section and the default as the avatar in the
  Employees list; the pictures are fetched with the bearer token and shown from object URLs, so
  the production CSP allows `img-src blob:`.
