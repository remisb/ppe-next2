# Ubiquitous language

The words this project uses for its domain and its screens, so the product contract
(the Developer Logic Manual), the Go code, the API, the web app, the Help guide and
conversations all say the same thing in the same way.

How to read an entry:

- **Brief**: one line, good enough for a tooltip or a code comment.
- **Detail**: the rules that make the term precise.
- **Code** / **UI**: the identifiers and the label the app shows (English; the
  Lithuanian and Russian labels are in [Translations](#translations)).

Rules for using it:

1. One concept, one word. Use the term as written here, in code, commits, docs and chat.
   If a new concept appears, add it here first.
2. UI labels are proper names. Write a control's name exactly as the app shows it, in
   **bold** in the Help guide (`**Mark as Ordered**`).
3. Where code and UI names differ (History / Orders, Receipt / Items Given Record), both
   are listed. Do not rename one to match the other unless you rename both.
4. [Words to avoid](#words-to-avoid) lists the synonyms that cause confusion.

---

## 1. People and access

### User
- **Brief:** a person who signs in to the staff app.
- **Detail:** has a name, a unique email (case-insensitive), a password (bcrypt), one or
  more roles, a language and an active flag. An inactive user cannot sign in; their past
  work keeps their name. Deleting a user is a soft delete, and no one can delete their own account.
- **Code:** `internal/domain/user`, table `users`. **UI:** Users screen, Account.

### Role
- **Brief:** a named bundle of permissions a user holds: the built-in `admin`, `manager`,
  `employee` and `equipment`, or a custom role an administrator adds.
- **Detail:** roles stack: a user may do what any of their roles allows. **Administrator**
  manages users, roles, Settings and Backups, plus everything a manager can do.
  **Manager** manages Item Catalogue prices and Item Sets, and may delete an order, plus
  everything the employee role can do. **Employee** (the role) prepares orders, follows
  them in Orders, and manages employees and sizes. **Equipment Assignments** sees Equipment &
  Furniture and who holds each item, which no other role does. A role change reaches the user within
  minutes (at their next token refresh). Every route's permission is pinned in
  `cmd/api/routes_test.go`.
- **Code:** `internal/domain/role` (`role.KeyAdmin`, `KeyManager`, `KeyEmployee`,
  `KeyEquipment`); JWT `perms` claim. **UI:** Administrator, Manager, Employee, Equipment
  Assignments.

### Permission
- **Brief:** one thing a role may allow, such as deleting orders or managing users.
- **Detail:** a fixed catalogue in code (`resource.action` keys); a route requires one.
  Administrators bundle permissions into roles; they never grant a permission to a user
  directly. Everything else a signed-in user does needs no permission.
- **Code:** `role.Permission`, `role.Catalogue()`; `web/packages/api-client/src/permissions.ts`.
  **UI:** Permission (on **Roles & permissions**).

### Built-in role
- **Brief:** Administrator, Manager, Employee or Equipment Assignments: the roles every
  installation has.
- **Detail:** the first three reproduce the access of the three fixed roles that came before
  permissions, less Equipment & Furniture. Equipment Assignments (migration 0032) grants only
  **See Equipment & Furniture** (`equipment.read`): who holds which computer, phone or desk is
  for the people given it, administrators included only when they hold it.
  Administrator cannot be changed or deleted; at least one active user always holds it.

### Administration
- **Brief:** the separate app at `/admin` for managing users, roles, Settings and Backups.
- **Detail:** shares the staff app's sign-in and look; the staff app links to it for users
  who may open one of its screens. Not the same as the **Dashboard**, which stays in the
  staff app.
- **Code:** `web/apps/admin`. **UI:** Administration.

### Employee role
- **Brief:** the role of staff who prepare orders; not the same thing as an Employee.
- **Detail:** say "the employee role" or "staff" when you mean a user. Say "employee"
  alone only for the person receiving workwear. See [Words to avoid](#words-to-avoid).

### Staff member
- **Brief:** any signed-in user acting in the app (preparer, giver).
- **Detail:** on records, a staff member appears as **Prepared by** (who marked the order
  as ordered) and as the **giver** (who handed the items over, for paper and in-person
  confirmation).

### Actor
- **Brief:** the user a change is attributed to.
- **Detail:** taken from the JWT `sub`, passed explicitly to every service call
  (`Create(ctx, params, actorID)`), never from the request body. Recorded on audit events
  and `*_by_user_id` columns.
- **Code:** `actorID(r)` in `cmd/api/auth.go`.

### Sign-in (session)
- **Brief:** one browser's signed-in state for one user, which lasts across closed tabs,
  reloads and a sleeping device.
- **Detail:** kept by the server as a session and in the browser as an HttpOnly refresh
  cookie that no script can read; the access token the app sends lives minutes and only in
  the open tab's memory. With **Keep me signed in** a sign-in lasts up to 30 days and ends
  after 14 days unused; without it, it ends when the browser closes and at most 12 hours
  after signing in. It also ends on **Sign out**, when signed out from another device,
  when the password is changed elsewhere or reset by an administrator, and when the account
  is deactivated or deleted. A role change applies within minutes, at the next refresh.
- **UI:** Sign in, Sign out.
- **Code:** `internal/domain/session`, `cmd/api/auth-routes.go`; spec
  `docs/specs/session-service.md`.

### Keep me signed in
- **Brief:** the box on Sign in that keeps the sign-in after the browser closes.
- **Detail:** ticked by default (staff devices are mostly their own); unticked on a shared
  computer, and then it stays unticked at the next sign-in on that device.

### Signed-in devices
- **Brief:** the card on Account listing every browser the user is signed in on.
- **Detail:** each with its browser and system ("Chrome on Windows"), when it was last used
  and from which address, and whether it is kept signed in. **This device** is first and
  signs out with the usual Sign out; each other has its own **Sign out**, and **Sign out all
  other devices** ends the rest. On Administration's **Security** the same name lists
  every user's, and whoever manages users signs one out.

### Confirm your password (recent sign-in)
- **Brief:** the dialog asking for the password again before managing users, when it was last
  entered more than 12 hours ago (`API_RECENT_SIGN_IN`).
- **Detail:** **Continue** confirms it and the change goes ahead; **Cancel** leaves it undone.
  A phone left signed in for weeks cannot add an administrator or reset a password without
  it.

### Overview
- **Brief:** Administration's first screen: what needs attention, worst first, then figures.
- **Detail:** each **attention item** (critical, warning or note) links to where it is put
  right: backups not running, a copied sign-in, many failed sign-ins, failing requests, new
  errors, an access review due, a fast-growing database. Each reader sees the areas their
  permissions open. Not the staff app's Dashboard, which is about workwear.
- **Code:** `GET /api/v1/overview`, `internal/overview`. **Spec:** `docs/specs/system-service.md`.

### Usage
- **Brief:** Administration's screen of who uses the apps and from what, sign-ins and
  changes over time, how far confirmation links get, and the data's quality. Needs
  `usage.read`.
- **Detail:** an **active person** used an app that day, whether they signed in that day or
  not. No page is tracked.
- **Code:** `internal/usage`, `/admin/usage`. **Spec:** `docs/specs/usage-service.md`.

### System
- **Brief:** Administration's screen of the API and its requests, the database, the error
  list, and the backups (a tab of its own, formerly the Backups screen). Needs `system.read`
  (Backups: `backups.read`).
- **Code:** `/admin/system`, `web/apps/admin/src/routes/system.tsx`.

### Security
- **Brief:** Administration's screen of **Sign-ins**, every user's **Signed-in devices** and
  the **Access review**. Needs `security.read`.
- **Code:** `/admin/security`, `web/apps/admin/src/routes/security.tsx`. **Spec:**
  `docs/specs/security-service.md`.

### Security event (sign-in record)
- **Brief:** a record of a sign-in, a failed attempt, a confirmed password, a sign-out or a
  sign-in ending, with the address and browser it came from.
- **Detail:** kept 180 days (`API_AUTH_EVENTS_RETENTION`), apart from the audit trail,
  because addresses are personal data (ADR 0003). The email of a failed attempt is kept only
  as a hash; an attempt at an email nobody has shows as **Unknown account**. A **copied
  sign-in** is a replaced refresh token used again: the sign-in is ended everywhere it was.
- **Code:** `internal/security`, table `auth_events`. **UI:** the Sign-ins tab; events
  "Signed in", "Sign-in failed", "Sign-in ended" and so on.

### Access review
- **Brief:** the periodic check that every user still needs the access their roles give.
- **Detail:** lists each user's roles, what they allow and the last sign-in, and marks
  Administrators and accounts not used for 90 days; **Mark as reviewed** records who
  reviewed and when, on the Audit log ("Access reviewed").
- **Code:** `GET/POST /api/v1/security/access-review`, audit event `access_review.completed`.

---

## 2. Employees and sizes

### Employee
- **Brief:** a person workwear is ordered for and given to.
- **Detail:** has a first and last name (required), an optional **employee code** (unique
  among live employees), size defaults (height, clothing size, shoe size), notes, and a
  preferred language. An employee does not sign in. Deleting one is a soft delete; their
  orders keep the name snapshot. Full name is derived, never stored. Planned: an employee
  may also hold [company assets](#12-company-assets), and leaving never returns them.
- **Code:** `internal/domain/employee`, table `employees`. **UI:** Employees, an employee's
  page, **Add New Employee**, **Edit details**, **Delete employee…**.

### Size defaults (saved sizes)
- **Brief:** the employee's reusable sizes that Create Order resolves lines from.
- **Detail:** height (100–250 cm), clothing size (even EU 44–66) and shoe size (39–46).
  Changing them affects future orders only; order lines snapshot the size they used. There
  is deliberately no glove size.
- **Code:** `size.Defaults`, `employee.SizesParams`. **UI:** **Edit Sizes**, "Saved sizes
  of …", "Affects future orders only."

### Size group
- **Brief:** which size dimension a catalogue item uses: Clothing, Shoes or No size.
- **Detail:** `CLOTHING` takes a clothing size, `SHOES` a shoe size, `NONE` (gloves,
  helmets…) none, stored as null and shown as an en dash.
- **Code:** `size.Group`. **UI:** Size group; Clothing, Shoes, No size.

### Clothing size and size band
- **Brief:** an even EU number (44–66), picked by its letter band.
- **Detail:** each **band** covers two EU sizes, `S (44–46)` to `3XL (64–66)`. Pickers offer
  the bands and store the larger number. Letter sizes on order lines from before migration
  0012 are kept as they were.
- **Code:** `size.ClothingSize{Code, Band}`.

### Size resolution
- **Brief:** choosing each line's size from the employee's size defaults (manual §4.4,
  algorithm A).
- **Detail:** clothing uses the saved clothing size, otherwise a size **suggested from
  height** when exactly one band matches. Shoes use the saved shoe size and are never
  inferred. No-size items get none. When nothing resolves, the line has a **missing size**.
- **Code:** `size.Resolve`, `order.Resolve`. **UI:** "Suggested from height".

### Suggested from height
- **Brief:** a clothing size proposed from the employee's height, never stored by itself.
- **Detail:** the user may change it. It becomes a saved size only through **Save as
  Employee Default** or Edit Sizes.

### Missing size
- **Brief:** a line, or an employee, without a size Create Order needs.
- **Detail:** not an error. The line shows an inline size picker, and the order cannot be
  marked as ordered until it is chosen. Employees missing a size are flagged on the
  Employees list ("Missing a size") and the dashboards.
- **UI:** Missing, **Add sizes**, "Select a size."

### Save as Employee Default
- **Brief:** keep a size picked by hand on an order as the employee's saved size.
- **Detail:** offered, in a pop-up ("Different size selected. Save it to employee profile?"),
  whenever a size picked by hand on a line differs from the employee's saved size for that
  group, or none is saved. **Skip size update** leaves the defaults alone.
- **UI:** **Save**, **Skip size update**.

### Preferred language
- **Brief:** the language an employee reads best: en, lt or ru, or not recorded.
- **Detail:** the confirmation page and hand-over mode open in it when it is English or
  Russian. It is looked up, not stored on the order; the record never changes with it.

---

## 3. Catalogue and item sets

### Item Catalogue
- **Brief:** the list of orderable items with their current names, prices and service periods.
- **Detail:** the only normal source of item values. They are copied into order lines at
  Mark as Ordered, so editing an item never changes an order. Managers and administrators
  edit it.
- **Code:** `internal/domain/catalogue`, table `catalogue_items`. **UI:** Item Catalogue.

### Catalogue item (item)
- **Brief:** one orderable entry: name, details (manufacturer / model), size group,
  purchase price, accounting price, service period, display order, picture.
- **Detail:** the accounting price and service period may be empty while the item is being
  set up. Such an item is **Incomplete** and cannot be ordered. The purchase price is always
  optional. **Inactive** items are not offered in Add
  Item; orders that hold them keep them. Currency is always EUR.
- **UI:** **Add Item** / **Edit Item**, Active, Inactive, Incomplete, **Deactivate item…**.

### Orderable
- **Brief:** an item that can go on a new order: live, active, with an accounting price and a
  service period.
- **Code:** `catalogue.Item.Orderable()`.

### Purchase price
- **Brief:** what we pay the supplier for one unit, in euro cents in code.
- **Detail:** optional: an item without one can still be ordered. Each order line keeps the
  purchase price the item had when it was ordered (none on lines from before migration 0021).
  Orders, records and dashboards never show or total it.
- **Code:** `purchase_price_cents`. **UI:** Purchase price, Purchase price (€).

### Accounting price
- **Brief:** what the organisation books for one unit, in euro cents in code: the price
  orders show.
- **Detail:** the catalogue holds the current one; each order line keeps the one it was
  ordered at, and order totals, records and dashboards use it. Every change to either price
  is an audit event and shows in an item's **price history** and the Manager Dashboard's
  **Price changes**. Called the unit price before items had two prices.
- **Code:** `accounting_price_cents` (`unit_price_cents` before migration 0021, and still on
  the Items Given Record, whose keys are part of its hash). **UI:** **Price**, Price (€): the
  app's plain "price" is the accounting price, and the other one is always called Purchase
  price. The Items Given Record and the confirmation page, which the employee reads, say
  Unit price / Цена.

### Service period
- **Brief:** how many months an item is meant to last after it is given.
- **Detail:** at least 1 month. With the given date it sets the **replacement date**.

### Display order
- **Brief:** where an item sorts in Add Item; lower comes first.

### Picture (icon)
- **Brief:** the item's pictogram from a fixed set (shoes, jacket, gloves, helmet…).
- **Code:** `catalogue.Icon`.

### Item Set
- **Brief:** a named kit of catalogue items with default quantities, applied in one tap.
- **Detail:** stores no sizes, prices or service periods. Applying it resolves those fresh
  from the employee and the catalogue (manual §3.4). Lines holding incomplete or inactive
  items are flagged when applied.
- **Code:** `internal/domain/itemset`. **UI:** Item Sets; **Item Set** buttons on Create Order.

---

## 4. Orders

### Order
- **Brief:** an immutable record that workwear was ordered for one employee.
- **Detail:** exists only from **Mark as Ordered** on. Its only later change is ORDERED →
  GIVEN through a confirmation, apart from a manager deleting a demo or test order. It
  snapshots the employee's name and code, the preparer's name and every line.
- **Code:** `order.Order`, table `orders`. **UI:** Orders, "Order WE-000123".

### Record number
- **Brief:** the order's human number, `WE-000123`.
- **Detail:** from a sequence; search accepts `WE-000004`, `we4`, `WE 4` or `4`.
- **Code:** `FormatRecordNumber`, `ParseRecordNumber`. **UI:** Record column, hover preview.

### Order status: Ordered and Given
- **Brief:** the only two stored statuses.
- **Detail:** **Ordered** (`ORDERED`): marked as ordered, waiting for the employee to
  confirm receipt. **Given** (`GIVEN`): the employee confirmed, the record is locked with
  its evidence. There is no draft, partial or outstanding status.
- **UI:** Ordered, Given; the Orders filters **Awaiting** (= Ordered), **Given**, **All**.

### Working order (draft)
- **Brief:** the order being prepared on Create Order, before Mark as Ordered.
- **Detail:** client state only, kept per user in this device's localStorage. It is never
  stored on the server and is not an order. Lines are **working lines**: previews of current
  data, not snapshots.
- **Code:** `web/.../lib/working-order.ts`, `order.WorkingLine`. **UI:** Draft, "(draft, 3 lines)".

### Order line (line)
- **Brief:** one item on an order: item, size, quantity, accounting price, purchase price,
  service period.
- **Detail:** one line per catalogue item; adding the item again raises the quantity.
  Stored lines are **snapshots** that the database refuses to update or delete.
- **Code:** `order.Line`, table `order_lines`. **UI:** Order lines, Remove line.

### Snapshot
- **Brief:** values copied onto the order at Mark as Ordered so it never depends on live data.
- **Detail:** item name, details, size group, size, both prices, currency, service period, and
  the employee and preparer names. Records, History and receipts read only snapshots.

### Create Order
- **Brief:** the screen where a working order is prepared.
- **Detail:** pick the employee in **Assigned to**, add lines with **Add Item** or an
  **Item Set**, resolve sizes, then **Review**. Reached from Orders' **Create Order** button,
  the phone's **New order** button, or "New order for …" in Search.
- **Code:** route `createOrder`, `routes/create-order.tsx`. **UI:** Create Order, New order.

### Review (Review order)
- **Brief:** the sheet that shows the whole order before it is marked as ordered.
- **Detail:** holds **Mark as Ordered** and **Copy for WhatsApp**. Opened by **Review**
  (phone and tablet bar) or **Review and mark as ordered** / `⌘/Ctrl Enter` (desktop).

### Mark as Ordered
- **Brief:** the one action that creates an order from the working order.
- **Detail:** re-reads every value from the catalogue in one transaction, refuses items
  without a price or service period, writes the order, its snapshot lines, an audit event
  and the employee's first confirmation link. Afterwards the order cannot be edited.
- **Code:** `POST /api/v1/orders`, `order.Service.MarkAsOrdered`. **UI:** **Mark as Ordered**.

### Prepared by
- **Brief:** the user who marked the order as ordered.

### Reorder
- **Brief:** start a new working order with an item that is due for replacement.
- **UI:** **Reorder**, **Reorder it**, **Reorder all N**, "Due for Ona" on Create Order.

### Delete order
- **Brief:** a manager's soft delete of a demo or test order.
- **Detail:** the order leaves Orders, the dashboards and Replacements due, and its link
  stops working. It cannot be undone in the app. Every query over orders filters
  `deleted_at IS NULL`.
- **UI:** **⋯ → Delete order…** (manager role only).

### Orders (History)
- **Brief:** the screen listing every order, newest activity first.
- **Detail:** filters by status, employee and dates (in the organisation timezone), and
  sorts by date or usage time. Opening an order shows it beside the list on a desktop and
  full screen below that.
- **Code:** route `history`, i18n `history`, `order/history.go`, `GET /api/v1/orders`.
  **UI:** Orders.

### Activity time
- **Brief:** when an order last changed status: given time, else ordered time.
- **Detail:** the default sort key and the date the Orders filters match.

---

## 5. Confirmation and the record

### Confirmation
- **Brief:** the employee's acknowledgement that they received the items, turning the order Given.
- **Detail:** recorded once with its evidence: method, time, the employee's name from the
  snapshot, the giver and the **document hash**. Idempotent: confirming a Given order again
  returns the same record and writes nothing.
- **Code:** `order.Confirmation`, table `order_confirmations`.

### Confirmation method
- **Brief:** how receipt was confirmed: electronic, paper or in person.
- **Detail:** **Electronic** (`ELECTRONIC`): the employee used a confirmation link.
  **Paper** (`PAPER`): staff recorded a signed printed record. **In person** (`IN_PERSON`):
  the employee confirmed on a staff device in hand-over mode (an addition to the manual).
- **UI:** "confirmed electronically / on paper / in person on a staff device".

### Confirmation link
- **Brief:** a single-use secure link the employee opens to confirm, without an account.
- **Detail:** valid for 7 days and shown once. Making another revokes earlier unused ones.
  Only the token's SHA-256 hash is stored, and the token travels in request bodies, not URLs
  sent to the API.
- **Code:** `CreateConfirmationLink`, `token.go`. **UI:** Confirmation link,
  **Share link via WhatsApp**, **Copy link**, **Open Employee Confirmation**, **Send link**.

### Confirmation page
- **Brief:** the public page at `/confirm/<token>` where the employee confirms.
- **Detail:** renders before the sign-in gate, in English or Russian (**EN / RU**), starting
  in the employee's preferred language when it is one of those. It shows the items, prices
  and total, the full record one tap away, and the consent statement to tick, then
  **Confirm receipt**.
- **Code:** `routes/confirm.tsx`, `components/confirmation.tsx`.

### Hand-over mode
- **Brief:** the employee confirms on the staff member's device at the counter.
- **Detail:** fills the screen with no app navigation and shows what the confirmation page
  shows. The staff member is recorded as giver and open links are revoked. **Hand back**
  (held for 1.5 seconds, or `Esc`) leaves it before the employee confirms.
- **Code:** `components/hand-over.tsx`. **UI:** **Hand over now**, Hand back.

### Paper confirmation
- **Brief:** the employee signs the printed record; staff record that it was signed.
- **UI:** **Print Record**, **Record signed paper confirmation**.

### Items Given Record (record)
- **Brief:** the locked bilingual document of an order, in English and Russian.
- **Detail:** built only from the order's snapshot, never from live data (manual §8). It
  carries the confirmation statements of the order's **receipt text version**. Once Given,
  it shows the evidence and its document hash. It prints on one A4 page with signature lines.
- **Code:** `order.Receipt`, `ReceiptOf`, `order.Record`, `components/receipt.tsx`.
  **UI:** **View Record**, **Print Record**, **Share via WhatsApp**, "Receipt WE-000123" on an
  employee's page.

### Confirmation text (consent statement)
- **Brief:** the statements the employee agrees to, in English and Russian blocks.
- **Detail:** versioned. Each order keeps the **receipt text version** it was placed under,
  so changing the wording never alters a stored record.
- **Code:** `ConfirmationTexts`, `ReceiptTextVersion`.

### Document hash
- **Brief:** the SHA-256 of the record's canonical JSON, stored with the confirmation.
- **Detail:** lets anyone check that a record still matches what the employee confirmed.

### Giver
- **Brief:** the user recorded as having handed the items over.
- **Detail:** the signed-in staff member for paper and in-person confirmation, the user who
  created the link for an electronic one.

---

## 6. Replacement and usage

### Usage time
- **Brief:** months since a Given order was given, to one decimal (algorithm D).
- **Detail:** days ÷ 30.44, counted in the organisation timezone; none for Ordered orders.
- **Code:** `order.UsageMonths`. **UI:** Usage time.

### Replacement date (due date)
- **Brief:** the date an item given to an employee should be replaced: given date plus
  service period.
- **Detail:** **Overdue** once it has passed. **Due soon** within the next 30 days. Only
  the employee's most recent Given line per item counts.

### Replacements due
- **Brief:** every item overdue or due soon and not already on an open order.
- **Code:** route `replacements`. **UI:** Replacements due (from a dashboard tile),
  Overdue, Due soon, Last given.

### Replacement forecast
- **Brief:** the Manager Dashboard's estimate of what will need buying: the same quantity
  again at today's catalogue price.

---

## 7. Supplier

### Supplier
- **Brief:** the company the workwear is ordered from, over WhatsApp.

### Copy for WhatsApp
- **Brief:** copies the supplier message for an order, then offers to open the supplier's group.
- **Detail:** only in Create Order's review. WhatsApp cannot open a group with a message
  typed in, so staff paste it there.
- **UI:** **Copy for WhatsApp**, "Open Superman Rubai Group and paste it there."

### Supplier message
- **Brief:** the WhatsApp text for the supplier: the record number, the employee and the
  lines with sizes and quantities (algorithm E).
- **Detail:** no prices, no status, no preparer or date. Written in the staff member's language.

### Supplier's WhatsApp group
- **Brief:** the organisation setting naming the group Copy for WhatsApp opens.
- **Detail:** a name staff recognise and an invite link `https://chat.whatsapp.com/<code>`.
  Both are set together or both cleared.
- **Code:** `settings.SupplierChat`. **UI:** Settings, **Remove the group**.

---

## 8. Dashboards

### Dashboard
- **Brief:** the administrator's start screen: figures, what needs doing, setup and backups.
- **Detail:** read-only figures in the organisation timezone. Deleted orders never count.
- **Code:** `internal/domain/dashboard`, `GET /api/v1/dashboard`. **UI:** Dashboard (Home on a phone).

### Manager Dashboard
- **Brief:** the manager's start screen about items, prices and purchasing.
- **Detail:** On order, spending by item, the replacement forecast, price changes,
  catalogue and item-set readiness, and **Sizes to stock**.

### Employee Dashboard
- **Brief:** the start screen of the employee role, about the signed-in user's own orders.
- **Detail:** orders still waiting for confirmation (**Send link**), items due, employees
  missing a size, orders by month, recently given.

### Key figures (KPI tile)
- **Brief:** the row of headline numbers at the top of a dashboard or Backups.
- **Detail:** a tile that opens a list shows a chevron. On a phone it shows one brief fact.
- **Code:** `KeyFigures`, `Kpi`.

### Needs you
- **Brief:** the administrator's to-do list, most urgent first, each row with its task button.
- **UI:** **Reorder** (overdue item), **Send link** (unconfirmed order), **Add sizes**
  (missing size), **Fix** (item without a price).

### Setup
- **Brief:** counts of active records and anything that holds up ordering (missing sizes,
  incomplete items, a single administrator).

### Awaiting confirmation
- **Brief:** Ordered orders not yet confirmed, with their value and the oldest wait.

### Median wait
- **Brief:** the median time from Mark as Ordered to the employee's confirmation.

---

## 9. Backups

### Backup service (backup agent)
- **Brief:** the separate service on the server that copies the whole database on a schedule.
- **Detail:** the `backup` compose service, built from the library `github.com/remisb/dbbackup`
  on the same Postgres image as the database. It writes each run and a heartbeat to the
  database; the app only reads them.
- **UI:** "the backup service". **Ops:** `docs/backups.md`.

### Backup
- **Brief:** one complete dump of the database, saved to the backup target.
- **Detail:** a Postgres custom-format dump with a key like
  `ppe2/2026/10/05/ppe2-20261005T030000Z.dump`, optionally encrypted (`.age`).

### Backup run
- **Brief:** one backup attempt, succeeded or failed, with its time, size, duration and
  database version.
- **Code:** table `dbbackup_runs`. **UI:** Recent backups, Succeeded, Failed.

### Schedule
- **Brief:** when backups are taken: a cron expression, nightly at 03:00 by default, in a
  named timezone.
- **UI:** Schedule, "Every day at 03:00".

### Backup target
- **Brief:** where backups are saved: the server's own disk (`file://`) or a bucket (`s3://`).
- **UI:** Saved to.

### Retention
- **Brief:** how long backups are kept before they are deleted: days and a minimum count.
- **Detail:** for example "14 days, at least 7". The newest backup is never deleted. A
  deleted backup stays listed as a run.
- **UI:** Kept, "Deleted after the retention period".

### Backup verdict
- **Brief:** the one line at the top of Backups (and the Dashboard card) saying whether all is well.
- **Detail:** worst first. **Service has not reported** (no agent). **Offline**: no heartbeat
  for 15 minutes. **Last backup failed**. **None yet**. **Overdue (stale)**: the newest
  success is older than the schedule interval plus 2 hours. Otherwise **up to date**.
- **Code:** `backupHealth` in `lib/backups.ts`; `Stale`, `AgentOffline`, `LastRunFailed`.

### Server-only warning
- **Brief:** shown while backups are kept only on the server, because they would be lost with it.

---

## 10. Records and data rules

### Audit event (change)
- **Brief:** an append-only record of a change: who, when, what, and where it was made.
- **Detail:** for example `order.ordered`, `order.given`, `catalogue.price_changed`,
  `employee.updated`, `user.roles_changed`, `item_set.updated`. It is written in the same
  transaction as the change; the database rejects updates and deletes. It records the changed
  fields before and after (never a password or notes text), the request's **reference**, the
  sign-in, and where it was **made in** (Workwear & Equipment, Administration, a confirmation
  link, the API or the system). Every event name is in `audit.Events()`.
- **Code:** `internal/audit`, table `audit_events`. **UI:** a **change**, named by its action
  ("Price changed") beside the record's name.

### Audit log
- **Brief:** Administration's screen of every recorded change, newest first.
- **Detail:** filtered by area, change, person, days and one record, the filters in its
  address; a change opens beside it with every field it changed. Needs `audit.read`.
- **Code:** `GET /api/v1/audit-events`, `web/apps/admin/src/routes/audit.tsx`.
  **Spec:** `docs/specs/audit-service.md`.

### Reference (of a request)
- **Brief:** the code a server error shows ("Reference: 9f2c1a7e"), for a person to quote.
- **Detail:** the first 8 characters of the request's ID (`X-Request-ID`). An
  administrator finds the request's log lines with it, and the error on System's error
  list. Audit events record the same ID.
- **UI:** Reference / Nuoroda į užklausą / Номер запроса.

### Error list
- **Brief:** System's list of the errors the API met (5xx answers, crashes) and the apps
  reported from the browser, one row per kind of error with how many times it happened.
- **Detail:** kept 30 days. A crash is a panic the API recovered from. Not the Audit log:
  errors change nothing.
- **Code:** `internal/system`, table `error_events`. **UI:** System → Errors.

### Seal (of the Audit log)
- **Brief:** a day's fingerprint of its changes, chained to the day before, so a change
  altered, added or removed afterwards shows.
- **Detail:** each UTC day is sealed an hour after it ends. **Verify** recomputes every
  seal; a day that does not match is an alert on the Audit log and the Overview.
- **Code:** `internal/audit` (`seal.go`), table `audit_seals`. **UI:** Seals, Sealed through,
  Verify.

### Timestamp (of a seal)
- **Brief:** a public timestamp service's signature that a seal's hash existed at a time,
  which no one can make later with an earlier time. EN "timestamp", LT "laiko žyma", RU
  "метка времени".
- **Detail:** each seal gets one within the hour; Verify checks them. A seal stamped late,
  or never, shows as a mismatch after 7 days.
- **Code:** `internal/tsa`, `internal/audit` (`stamp.go`), table `audit_seal_stamps`,
  `API_AUDIT_TSA_URL`. **UI:** Seals ("Timestamped through …").

### Export (of the Audit log)
- **Brief:** a file of the changes the Audit log's filters select between two days, at most
  a year apart: CSV for a spreadsheet or JSON lines for an archive.
- **Detail:** needs `audit.export`; each export is itself on the Audit log ("Audit log
  exported").

### Changes (of a record)
- **Brief:** the section of an employee's, a catalogue item's or an order's page listing
  that record's changes, newest first; a user's are under ⋯ → Changes on Users.
- **Detail:** for whoever may open the record. Not called History, which is the old name of
  Orders.
- **Code:** `GET /api/v1/audit-events/{employees|catalogue|orders|assets|users}/{id}`,
  `RecordChanges` in `@ppe/audit`.

### Soft delete
- **Brief:** marking a row deleted (`deleted_at`) instead of removing it.
- **Detail:** used everywhere; reads filter `deleted_at IS NULL`.

### Organisation timezone
- **Brief:** the one timezone all dates are shown and filtered in.
- **Code:** `API_ORG_TIMEZONE` (Europe/Vilnius). **UI:** "Dates are shown in Europe/Vilnius."

### Developer Logic Manual (the manual)
- **Brief:** the product contract. Section (§) and algorithm (A, C, D, E) references point to it.
- **Detail:** `../PPE-documents/Workwear_Equipment_App_Developer_Logic_Manual.docx`;
  `docs/testing.md` maps its rules to tests.

---

## 11. UI elements

### Device classes
- **Brief:** phone (below 768 px), tablet (768–1279 px) and desktop (1280 px and wider).
- **Detail:** one Main navigation reshaped per class. Touch targets are at least 44 px.
  No screen may scroll sideways at 375, 768, 920, 1100 or 1280 px.

### Main navigation
- **Brief:** the app's sections, shaped by device.
- **Detail:** **bottom bar** on a phone (Home, Orders, the raised **New order** button,
  Employees, **More**). **Rail** on a tablet (icons with short labels, Search at the top).
  **Sidebar** on a desktop (full labels, **Search…**, Help, Keyboard shortcuts, the account
  and Sign out at its foot).
- **UI:** landmark "Main"; short labels Home, Order, Orders, Assets, Catalogue, Sets, Keys, Account.
  Company Assets follows Employees, so on a phone it is under More.

### More
- **Brief:** the phone's menu holding the sections that do not fit the bottom bar, plus
  Search, Help, the account and Sign out.

### New order button
- **Brief:** the phone's raised Create Order button in the bottom bar; shows **Draft** while a
  working order is saved.

### Search (⌘K palette)
- **Brief:** finds record numbers, employees, items and screens, and runs actions such as
  "New order for …".
- **Detail:** `⌘K` / `Ctrl K` on a desktop; Search in the rail or under More elsewhere. It
  also switches theme and table-row density.
- **Code:** `components/command-palette.tsx`. **UI:** "Search or jump to".

### Keyboard shortcuts
- **Brief:** desktop keys: `/` search field, `G` then a letter to go to a screen, `J`/`K`
  through Orders, `Esc` close, `⌘/Ctrl Enter` review, `?` list them.
- **Code:** `lib/shortcuts.ts`.

### Help (user guide)
- **Brief:** the in-app guide at `/help`, limited to the reader's roles and device, with that
  device's screenshots.
- **Detail:** text in `src/help/{en,lt,ru}.ts`; `pnpm guide` regenerates the screenshots and
  `docs/guide`.

### Account
- **Brief:** the signed-in user's own page: Language, Theme, Change password, Table rows.
- **Detail:** **Language** is saved on the account. **Theme** (Light, Dark, System) and
  **Table rows** (Comfortable, Compact) are kept on this device.

### Settings (organisation)
- **Brief:** the administrator's screen for organisation-wide settings; today, the supplier's
  WhatsApp group.
- **Detail:** not the same as Account, and not the read-only **Settings** panel on Backups.

### Page header
- **Brief:** a screen's title with its main action beside it, and the description below.
- **Code:** `PageHeader`.

### Panel
- **Brief:** a titled card that is a region of a dashboard or Backups.
- **Code:** `Panel`.

### Table and stacked cards
- **Brief:** lists are tables on wide screens and stack into one labelled card per row when narrow.
- **Code:** `<Table stack>`, the `stacked:` container-query variant.

### Order pane
- **Brief:** an order opened from Orders: beside the list on a desktop, full screen below that.
- **Detail:** holds the order's actions by status. Ordered: Open Employee Confirmation,
  Hand over now, Print Record. Given: View Record, Print Record, Share via WhatsApp.
  Manager role: ⋯ → Delete order…

### Record number preview
- **Brief:** the hover card on a record number showing the order's status, dates and first lines.

### Assigned to (employee picker)
- **Brief:** the combobox on Create Order that chooses who the order is for; offers
  **+ Add New Employee**.

### Add Item (item picker)
- **Brief:** the search field on Create Order that adds one catalogue item (`/` jumps to it).
- **Detail:** not the same as the Item Catalogue's **Add Item** button, which creates a
  catalogue item.

### Quantity stepper
- **Brief:** a line's quantity with one-fewer / one-more buttons.

### Order summary
- **Brief:** Create Order's panel (desktop) or bottom bar (phone, tablet) with the employee,
  line count, total and the review button.

### Badge
- **Brief:** a short status label: Ordered, Given, Active, Inactive, Incomplete, Overdue,
  Succeeded, Failed.

### More actions (⋯)
- **Brief:** a row's or order's menu of less common actions (Edit, Reset password…,
  Delete…).

### Empty state, Error state, Loading
- **Brief:** a dashed box saying a list is empty (with a next step); an error with
  **Try again**; a loading indicator.
- **Code:** `EmptyState`, `ErrorState`, `Loading`.

### Refresh
- **Brief:** reloads a dashboard or Backups (an icon only on a phone).

### Form sheet
- **Brief:** the modal holding an add or edit form (Add New Employee, Edit Item, Add User): a
  bottom sheet on a phone, a centred dialog from tablet width.
- **Code:** `components/ui/form-sheet.tsx`.

---

## 12. Company Assets

Specified in [asset-service.md](specs/asset-service.md) and
[ADR 0004](architecture/adr/0004-company-assets.md). The API and the SIM card register are built;
the asset page with giving, returning, Not Returned and the blocking email, Given SIM and
Equipment on the employee page, Equipment & Furniture and signed copies, too. The product contract is
`../PPE-documents/GAVORT_SIM_ir_inventoriaus_apskaitos_uzduotis.pdf` (the **assets brief**,
v1.0, 2026-10-08); § references in this section point to it, not to the manual.

### Company Assets
- **Brief:** the staff app's section for the company's individually tracked items: SIM
  Cards, and Equipment & Furniture.
- **Detail:** a register (list) per kind with summary tiles, an item's page, and the
  employee page's Given SIM and Equipment sections. Not workwear: workwear is ordered by
  catalogue item and quantity, and never comes back.
- **Code:** `internal/domain/asset`, `routes/assets.tsx` (`/assets`, G then A). **UI:**
  Company Assets (short label Assets), tabs **SIMs** and **Equipment & Furniture**
  (`/assets?kind=equipment`).

### Asset
- **Brief:** one physical item the company owns and tracks on its own: a SIM card, a
  computer, a desk.
- **Detail:** one record per physical item; three identical laptops are three assets, never
  one line with a quantity (§2, §15). Its **kind** is SIM or EQUIPMENT. An asset is not a
  catalogue item and is never on an order.
- **Code:** table `assets` (planned). **UI:** "SIM", "asset"; never "item" alone, which
  is a catalogue item.

### SIM card
- **Brief:** an asset of kind SIM: one physical card.
- **Detail:** its **SIM No.** (the number printed on the card) and **Phone No.** are
  different facts: a card has one SIM No. for life, and its phone number may be unknown when
  it arrives (§2, §4). The SIM No. is kept exactly as typed, leading zeros included.
- **UI:** "SIM" (plural "SIMs"), never "SIM card": **Add SIM**, **Edit SIM**, SIM No., Phone No.
  Lithuanian and Russian also say "SIM" (not "SIM kortelė", "SIM-карта").

### Equipment & Furniture
- **Brief:** assets of kind EQUIPMENT, each with a **category**: Computer, Phone, External
  Drive, Furniture or Other.
- **Detail:** has a Name and an optional Serial No.; has no connection status (§17).
- **UI:** **Add Asset**, **Save Asset**.

### Inventory No.
- **Brief:** the company's unique number of an asset, `SIM-000001`, `PC-000001`, ….
- **Detail:** suggested from a counter per prefix (SIM, PC, PH, DRV, FUR, AST) or typed in
  when the company already numbered the item. Unique; a number once used is never given to
  another asset, and the system never changes one by itself (§16).

### Provider and Plan
- **Brief:** the mobile operator a SIM card is from, and its tariff plan.
- **Detail:** the provider's e-mail address is shown where staff must write to it
  (activation, blocking). Nothing is sent from the app.

### Default provider
- **Brief:** the provider Add SIM fills in for a new card, one for the organisation.
- **Code:** `settings.DefaultSIMProvider`, `default_sim_provider`. **UI:** **Default for new
  cards**, under Provider on Add SIM.
- **Detail:** set or cleared there as a card is saved; it changes no card already registered.

### Connection status
- **Brief:** what the provider says about a SIM card's service: **Not Activated**, **Active**
  or **Blocked**.
- **Detail:** recorded by staff with **Change Status** once the provider confirms; changing it
  never activates or blocks anything, and never changes where the card is or who holds it
  (§5). SIM cards only. A blocked card is not a returned card.
- **UI:** Status column, **Change Status**.

### Assignment
- **Brief:** one giving of an asset to one employee, from its **Given Date** until it is
  returned.
- **Detail:** an asset has at most one **open** assignment (not yet returned). A new holder
  is a new assignment with its own form; the old one is never overwritten (§2, §12). The
  brief's *išdavimas*.
- **Code:** table `asset_assignments` (planned). **UI:** **Assignments** on an asset's page.

### Holder (Held By)
- **Brief:** the employee of an asset's open assignment.
- **Detail:** stays the holder when the asset is marked Not Returned, and is still shown as
  the last holder when the whereabouts are Unknown (§3, §13). An employee leaving the company
  never ends an assignment.
- **UI:** Held By column.

### Location
- **Brief:** where an asset physically is: **Office**, **With Employee** or **Unknown**.
- **Detail:** follows from the assignment, never typed: no open assignment is Office; an
  open one is With Employee, or Unknown when it is marked Not Returned with unknown
  whereabouts. Any other place is said in the asset's Comment (§3).
- **UI:** Held By / Location column, the Office and Unknown filters.

### Give SIM, Give Asset
- **Brief:** registering that an asset was given to an employee: one form.
- **Detail:** only an asset in the Office with no holder can be given, and a SIM card only
  when Active. The employee signs the printed assignment form first (§6, §7, §17).
- **UI:** **Give SIM**, **Give Asset**; on success "SIM given to [Employee Name]."

### Given SIM
- **Brief:** the employee page's section of SIM cards the employee holds or held.
- **UI:** **Given SIM**, and **Equipment** beside it.

### Given Date and Days Held
- **Brief:** the date the asset was actually given, and the days since then (to today, or to
  the return date).
- **Detail:** the given date is a calendar day in the organisation timezone, never in the
  future, and kept apart from when the assignment was typed in. Days Held is how long it was
  held, not how long the service was active (§10).

### Register SIM Return, Register Asset Return
- **Brief:** recording that an asset is physically back in the office.
- **Detail:** ends the open assignment; the asset is in the Office again. The connection
  status does not change (§11).

### Not Returned
- **Brief:** a mark on an open assignment: the employee has not returned the asset and is
  not expected to soon.
- **Detail:** set with **Mark as Not Returned** and a comment. The asset stays with its
  holder and out of office stock. A later physical return is registered as usual, and the
  mark stays in the assignment (§13).
- **UI:** **Mark as Not Returned**, the Not Returned badge, tile and filter.

### Office stock (In Office)
- **Brief:** the assets in the office with no holder, the only ones that can be given.
- **Detail:** derived from open assignments, never counted by hand.

### Summary tiles
- **Brief:** Total SIMs, In Office, With Employees, Not Returned at the top of the
  register; tapping one filters the list.
- **Detail:** they overlap (a Not Returned card is also With Employees), so they are never
  added up (§3). Total excludes written-off cards.

### Assignment form (form)
- **Brief:** the paper document an employee signs for an assignment of a SIM card or a
  computer, separate from workwear's Items Given Record.
- **Detail:** printed from the Give form (**Preview Form**, **Print Form**), dated with the
  given date. Once the asset is given, the form's data is kept with the assignment and
  never changes, like a record's snapshot, with its own document hash. **Paper Form Signed**
  is ticked when the employee has signed; changing the form after printing clears it (§8).
- **UI:** Preview Form, Print Form (Print again once printed; prints from the page, no tab),
  Download PDF, and the checkbox "The employee has signed the printed form", recorded as
  Paper Form Signed. On an assignment: Print form again, Download PDF. Give's steps: **Who and when**,
  **Print the form and have it signed**, **Hand over the SIM** (the item). A print and a copied
  blocking email are recorded: "Form printed" (Format: Printed or PDF downloaded), "Blocking email
  prepared".

### Signed copy
- **Brief:** a scan or photo of the signed assignment form, kept with that assignment.
- **Detail:** may be added later, also after the return; its absence never blocks giving once
  Paper Form Signed is ticked (§9). A PDF, JPEG or PNG of up to 10 MB. Uploading again adds a
  copy: the newest is shown, the earlier ones stay. Only an assignment with a form has one.
- **UI:** **Upload Signed Form**, **Signed Copy Uploaded**, **Signed Copy Missing**; the
  register's **Documents** filter finds the missing ones.

### Blocking email
- **Brief:** a text to copy into the user's own e-mail, asking the provider to block a SIM
  card.
- **Detail:** preparing it changes nothing; staff set Blocked with Change Status once the
  provider confirms (§14).
- **UI:** **Prepare Blocking Email**.

### Non-return Value
- **Brief:** what the employee owes if the asset is not returned; printed on the form with
  its currency.

### Received Date
- **Brief:** the date a SIM card arrived from the provider.
- **Detail:** the one place "received" is used; it never means Given.

---

## Translations

The staff app speaks English, Lithuanian and Russian (each user's choice). The
confirmation page, hand-over mode and the Items Given Record stay English / Russian.

| English | Lietuvių | Русский |
|---|---|---|
| Dashboard | Suvestinė | Сводка |
| Manager Dashboard | Vadovo suvestinė | Сводка менеджера |
| Employee Dashboard | Darbuotojo suvestinė | Сводка сотрудника |
| Create Order | Kurti užsakymą | Создать заказ |
| Orders | Užsakymai | Заказы |
| Employees | Darbuotojai | Сотрудники |
| Item Catalogue | Prekių katalogas | Каталог предметов |
| Item Set / Item Sets | Prekių rinkinys / Prekių rinkiniai | Набор предметов / Наборы предметов |
| Users | Naudotojai | Пользователи |
| Administration | Administravimas | Администрирование |
| Roles & permissions | Rolės ir teisės | Роли и права |
| Role / Permission | Rolė / Teisė | Роль / Право |
| Equipment Assignments (role) / See Equipment & Furniture (permission) | Įrangos išdavimai / Matyti įrangą ir baldus | Выдачи оборудования / Видеть оборудование и мебель |
| Settings | Nustatymai | Настройки |
| Backups | Atsarginės kopijos | Резервные копии |
| Audit log | Audito žurnalas | Журнал аудита |
| Changes (of a record) / Change | Pakeitimai / Pakeitimas | Изменения / Изменение |
| Made in / Reference | Kur atlikta / Nuoroda į užklausą | Где сделано / Номер запроса |
| Replacements due | Reikia pakeisti | Требуется замена |
| Assigned to | Kam skirta | Для кого |
| Add Item | Pridėti prekę | Добавить предмет |
| + Add New Employee | + Naujas darbuotojas | + Новый сотрудник |
| Review / Review order | Peržiūrėti / Užsakymo peržiūra | Проверить / Проверка заказа |
| Mark as Ordered | Pažymėti kaip užsakytą | Отметить как заказанный |
| Ordered / Given | Užsakyta / Išduota | Заказано / Выдано |
| Awaiting | Laukia | Ожидают |
| Open Employee Confirmation | Atidaryti darbuotojo patvirtinimą | Открыть подтверждение сотрудника |
| Confirmation link | Patvirtinimo nuoroda | Ссылка для подтверждения |
| Send link | Siųsti nuorodą | Отправить ссылку |
| Hand over now | Išduoti dabar | Выдать сейчас |
| Record signed paper confirmation | Pažymėti pasirašytą popierinį patvirtinimą | Отметить подписанное подтверждение на бумаге |
| View Record / Print Record | Peržiūrėti įrašą / Spausdinti įrašą | Открыть запись / Печать записи |
| Delete order… | Ištrinti užsakymą… | Удалить заказ… |
| Copy for WhatsApp | Kopijuoti į WhatsApp | Копировать для WhatsApp |
| Supplier's WhatsApp group | Tiekėjo WhatsApp grupė | Группа поставщика в WhatsApp |
| Edit Sizes | Keisti dydžius | Изменить размеры |
| Save as Employee Default | Išsaugoti kaip numatytąjį | Сохранить как размер сотрудника |
| Preferred language | Pageidaujama kalba | Предпочитаемый язык |
| Size group | Dydžių grupė | Группа размеров |
| Clothing / Shoes / No size | Drabužiai / Avalynė / Be dydžio | Одежда / Обувь / Без размера |
| Purchase price | Pirkimo kaina | Закупочная цена |
| Price (the accounting price) | Kaina | Цена |
| Service period | Naudojimo laikotarpis | Срок службы |
| Usage time | Naudojimo trukmė | Срок использования |
| Items given | Išduotos prekės | Выданные предметы |
| Active / Inactive / Incomplete | Aktyvi / Neaktyvi / Neužpildyta | Активен / Неактивен / Не заполнен |
| Reorder | Užsakyti vėl | Заказать снова |
| Needs you | Reikia jūsų dėmesio | Требует внимания |
| Key figures | Pagrindiniai rodikliai | Основные показатели |
| Setup | Sąranka | Настройка |
| Last backup | Paskutinė kopija | Последняя копия |
| Recent backups | Naujausios kopijos | Последние копии |
| Keep me signed in | Likti prisijungus | Оставаться в системе |
| Signed-in devices / This device | Prisijungę įrenginiai / Šis įrenginys | Устройства со входом / Это устройство |
| Sign out all other devices | Atjungti visus kitus įrenginius | Выйти на всех других устройствах |
| Confirm your password | Patvirtinkite slaptažodį | Подтвердите пароль |
| Security | Sauga | Безопасность |
| Overview / Needs attention | Apžvalga / Reikia dėmesio | Обзор / Требует внимания |
| Seals / Verify / Export | Antspaudai / Patikrinti / Eksportuoti | Печати / Проверить / Выгрузить |
| Usage / Active people | Naudojimas / Aktyvūs asmenys | Использование / Активные люди |
| System / Errors / Status | Sistema / Klaidos / Būsena | Система / Ошибки / Состояние |
| Sign-ins / Sign-in failed / Unknown account | Prisijungimai / Prisijungti nepavyko / Nežinoma paskyra | Входы / Неудачный вход / Неизвестная учётная запись |
| Access review / Mark as reviewed | Prieigos peržiūra / Pažymėti kaip peržiūrėtą | Проверка доступа / Отметить как проверенный |

The dictionaries in `web/apps/workwear/src/i18n/{en,lt,ru}` are the source; this
table follows them.

Company Assets (proposed: not in the dictionaries yet, which become the source when the
screens are built):

| English | Lietuvių | Русский |
|---|---|---|
| Company Assets | Įmonės turtas | Имущество компании |
| SIMs / SIM | SIM | SIM |
| Equipment & Furniture | Įranga ir baldai | Оборудование и мебель |
| Inventory No. / SIM No. / Phone No. / Serial No. | Inventoriaus Nr. / SIM Nr. / Telefono Nr. / Serijos Nr. | Инвентарный № / № SIM / № телефона / Серийный № |
| Provider / Plan | Tiekėjas / Planas | Оператор / Тариф |
| Default for new cards | Numatytasis naujoms kortelėms | По умолчанию для новых карт |
| Not Activated / Active / Blocked | Neaktyvuota / Aktyvi / Užblokuota | Не активирована / Активна / Заблокирована |
| Change Status | Keisti būseną | Изменить статус |
| Office / With Employee / Unknown | Biure / Pas darbuotoją / Nežinoma | В офисе / У сотрудника / Неизвестно |
| Held By | Kas turi | У кого |
| Assignment / Assignments | Išdavimas / Išdavimai | Выдача / Выдачи |
| Give SIM / Give Asset | Išduoti SIM / Išduoti turtą | Выдать SIM / Выдать имущество |
| Given SIM | Išduotos SIM | Выданные SIM |
| Given Date / Days Held | Išdavimo data / Turima dienų | Дата выдачи / Дней на руках |
| Register SIM Return / Register Asset Return | Registruoti SIM grąžinimą / Registruoti turto grąžinimą | Зарегистрировать возврат SIM / Зарегистрировать возврат имущества |
| Not Returned / Mark as Not Returned | Negrąžinta / Pažymėti kaip negrąžintą | Не возвращено / Отметить как не возвращённое |
| Total SIMs / In Office / With Employees | Iš viso SIM / Biure / Pas darbuotojus | Всего SIM / В офисе / У сотрудников |
| Preview Form / Print Form / Paper Form Signed | Peržiūrėti aktą / Spausdinti aktą / Aktas pasirašytas | Просмотреть акт / Печать акта / Акт подписан |
| Download PDF / Print again | Atsisiųsti PDF / Spausdinti dar kartą | Скачать PDF / Напечатать ещё раз |
| Upload Signed Form / Signed Copy Uploaded / Signed Copy Missing | Įkelti pasirašytą aktą / Pasirašyta kopija įkelta / Trūksta pasirašytos kopijos | Загрузить подписанный акт / Подписанная копия загружена / Нет подписанной копии |
| Prepare Blocking Email | Paruošti blokavimo laišką | Подготовить письмо о блокировке |
| Non-return Value / Received Date | Negrąžinimo vertė / Gavimo data | Стоимость при невозврате / Дата получения |
| Add SIM / Add Asset / Save Asset | Pridėti SIM / Pridėti turtą / Išsaugoti turtą | Добавить SIM / Добавить имущество / Сохранить имущество |

---

## Words to avoid

| Avoid | Say instead | Why |
|---|---|---|
| SIM card, SIM Card (in the UI), SIM kortelė, SIM-карта | **SIM**, **SIMs** | Since 2026-10-10 the screens say SIM; the code and these docs may still say SIM card. |
| "employee" for a user | **user**, **staff member**, **the employee role** | An Employee receives workwear and never signs in. |
| draft order, pending, partial, outstanding (as statuses) | **working order**; **Ordered** | Only ORDERED and GIVEN exist; a working order is not stored. |
| delivered, received, completed, closed | **Given** | The status is GIVEN, set only by a confirmation. A SIM card's **Received Date** (from the provider) is the one exception. |
| hand-over, issue, allocation (for an asset) | **assignment**; **Give SIM** / **Give Asset** | Hand-over mode is workwear's in-person confirmation. |
| act, receipt, record, hand-over form (for an asset) | **assignment form** (UI: Form) | Record and receipt are the order's Items Given Record. |
| returned (for a blocked card), deactivated, disconnected | **Blocked** | Blocking is a connection status; only Register SIM Return makes a card returned. |
| lost, missing, stolen (for an asset) | **Not Returned**; location **Unknown** | Loss and write-off are not defined yet (assets brief §20). |
| stock, warehouse, free (for assets) | **In Office** (office stock) | One word for the tile, the filter and the location. |
| item, product (for an asset) | **asset**, **SIM card** | An item is a catalogue item, ordered by quantity. |
| quantity (of assets) | (none: one asset is one physical item) | |
| receipt (in the UI) | **Items Given Record** / **record** | `Receipt` is the code name. The UI says "Receipt WE-…" only on an employee's page. |
| History (in the UI) | **Orders**; a record's **Changes** | `history` is the route and namespace name; the screen is Orders. A record's list of changes is Changes. |
| activity log, change log, event log | **Audit log** | One screen, one name. |
| product, article, SKU | **item** / **catalogue item** | |
| cost, cost price, savikaina, supplier price, buy price | **purchase price** | "Cost" says nothing about to whom; *savikaina* is production cost. |
| sell price, sale price, net / gross price | **accounting price** | Nothing is sold to employees, and net / gross suggest VAT. |
| unit price, accounting price (in the UI) | **Price**; **Purchase price** for the other one | "Price" alone is the accounting price; the purchase price is never called just "price". The Items Given Record keeps "Unit price". |
| kit, bundle, template | **Item Set** | |
| expiry, lifetime, warranty | **service period** | |
| age, worn for | **usage time** | |
| approve, sign off (online) | **confirm receipt** | Signing is only for paper confirmation. |
| invite link (for the employee) | **confirmation link** | "Invite link" is the supplier group's WhatsApp link. |
| edit an order | (not possible) | After Mark as Ordered an order is immutable; delete is for demo and test orders only. |
| backup settings (as editable) | **backup service settings**, set on the server | The app only shows them. |
| Settings (for Account or Backups' panel) | **Account**; Backups **Settings** panel | Settings is the organisation's screen. |
| remember me, stay logged in, session (in the UI) | **Keep me signed in**; **sign-in** | One phrase on every screen; "session" is the code name. |
| log in, log out | **sign in**, **sign out** | |
| login history, auth log, security log (in the UI) | **Sign-ins** on **Security** | "Security log" is the code's name for `auth_events`. |
| revoke, kill (a session) | **sign out** (a device) | The same words as Account. |
| dashboard (in Administration) | **Overview** | The Dashboard is the staff app's screen of workwear figures. |
| error ID, trace ID, correlation ID (in the UI) | **reference** | One word on every error message. |
| logs, incidents (for the error list) | **Errors** on **System** | |
