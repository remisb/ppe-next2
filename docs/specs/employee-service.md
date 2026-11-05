# Employee service

People workwear is ordered for, and their reusable size defaults. Package
`internal/domain/employee`, routes in `cmd/api/employee-routes.go`, table from migration
`0003_employees` (clothing size made numeric by `0012_numeric_clothing_size`, preferred
language added by `0017_employee_language`). Manual §3.2
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
| `GET /api/v1/employees/by-name/{q}` | any authenticated | **filter** (Assigned to search): matches first, last, full name or code, case-insensitive substring, max 50; no match is `200 []` |
| `POST /api/v1/employees` | `employee_profiles.manage` | body: all entity fields except derived; the sizes only with `employee_sizes.manage` |
| `PUT /api/v1/employees/{id}` | `employee_profiles.manage` | full replace of the same body; the sizes kept without `employee_sizes.manage` |
| `PUT /api/v1/employees/{id}/sizes` | `employee_sizes.manage` | Edit Sizes / the **Save** button of Create Order's size pop-up (`item-set-service.md`): `{height_cm, clothing_size, shoe_size}`, all three replaced |
| `DELETE /api/v1/employees/{id}` | admin, manager | soft delete |

## Audit

`employee.created` (after = sizes), `employee.updated` (the changed first and last name, code
and preferred language before/after, and `notes_changed: true` when the notes changed, never
their text), `employee.sizes_changed` (before/after sizes, only when a size default actually
changes, from either PUT), `employee.deleted`. One PUT that changes both details and sizes
records both events. Each is written in the same transaction as the change, from the row read
under `FOR UPDATE`. They read on the Audit log and the employee's Changes
([audit-service.md](audit-service.md)).

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
