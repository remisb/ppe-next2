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
| `full_name` | Derived, response only |

There is no glove size: gloves and similar PPE are no-size items.

Sizes are **defaults for future orders**. Orders snapshot the size they used, so editing an
employee never alters an existing order.

Clothing sizes were letters (S … 3XL) until migration 0012, which converted saved sizes
S→46, M→50, L→54, XL→58, 2XL→62, 3XL→66. Order lines are immutable and keep the letters
they were ordered in; new lines hold the number as a string code (`"54"`). Audit events
written before 0012 likewise keep `clothing_size` as a letter string.

## Routes

| Route | Access | Kind |
| --- | --- | --- |
| `GET /api/v1/employees` | any authenticated | list |
| `GET /api/v1/employees/{id}` | any authenticated | 404 on miss |
| `GET /api/v1/employees/by-name/{q}` | any authenticated | **filter** (Assigned to search): matches first, last, full name or code, case-insensitive substring, max 50; no match is `200 []` |
| `POST /api/v1/employees` | any authenticated | body: all entity fields except derived |
| `PUT /api/v1/employees/{id}` | any authenticated | full replace of the same body |
| `PUT /api/v1/employees/{id}/sizes` | any authenticated | Edit Sizes / the **Save** button of Create Order's size pop-up (`item-set-service.md`): `{height_cm, clothing_size, shoe_size}`, all three replaced |
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
- **Access.** Like the employee's other details: any signed-in user.
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
