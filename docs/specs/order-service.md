# Order service: Mark as Ordered

The Order aggregate: `internal/domain/order` (orders, snapshot lines, confirmations),
routes in `cmd/api/order-routes.go`, tables from migrations `0006_orders` and
`0007_order_confirmations`. Manual §1, §3.1, algorithm B and algorithm E. Resolution
(algorithm A) is described in [item-set-service.md](item-set-service.md).

## Statuses

Only `ORDERED` and `GIVEN` are ever stored. An unsubmitted order is client working state;
there is no draft row. The only transition is ORDERED → GIVEN through a confirmation
(Slice 6). Orders and lines are never updated or deleted otherwise; `order_lines` rejects
UPDATE/DELETE with a trigger.

## Mark as Ordered — `POST /api/v1/orders` (any authenticated)

Body: `{employee_id, lines: [{catalogue_item_id, quantity, size}]}` — nothing else is
accepted (a client-sent price is a 400). In one SQL transaction the repository:

1. share-locks the live employee (404 if missing or deleted),
2. reads the preparer's name (401 if the actor is not a user),
3. share-locks the requested catalogue items,
4. takes `nextval('order_record_seq')`,
5. calls the service's build closure, which requires each item to be live and active
   (`ErrItemUnavailable`, 409), to have a price and service period (`ErrPriceMissing`,
   409, naming the item), and each size to fit the item's size group (400),
6. inserts the order, its lines and an `order.ordered` audit event.

Any failure rolls everything back (a record number may be skipped). The response (201) is
the stored order with derived `record_number` (`WE-000123`) and `total_cents`.

Snapshotted on the order: employee first/last name and code, preparer name. On each line:
item name, details, size group, size, quantity, unit price, currency, service period.
History and receipts use only these values.

`GET /api/v1/orders/{id}` returns a stored order with its lines.

## Copy for WhatsApp (algorithm E)

Formatted client-side (`web/apps/workwear/src/lib/whatsapp.ts`) from the working order or a
stored snapshot: record number when stored, employee (and code), each line's item, details,
size when applicable and quantity, preparer and date. No prices. Copying or opening
WhatsApp changes no status and never claims delivery.

## History — `GET /api/v1/orders`

Any authenticated user. Reads stored orders and snapshot lines only, never live catalogue
or employee data. Newest activity first, where activity is `coalesce(given_at,
ordered_at)`.

Query parameters (an exception to the path-segment rule; see the domain contract), all
optional; anything else is a 400:

| Parameter | Meaning |
| --- | --- |
| `employee_id` | One employee's orders |
| `status` | `ORDERED` or `GIVEN`; omitted = all statuses |
| `from`, `to` | `YYYY-MM-DD`, inclusive, matched against the activity time as a calendar day in the organisation timezone (`API_ORG_TIMEZONE`, default `Europe/Vilnius`); timestamps stay UTC |
| `sort` | `date` (default), `record`, `employee`, `status`, `usage` or `total`; sorts the whole history before paging. `usage` ascending is most recently given first, and ORDERED orders (no usage time) come last in both directions |
| `dir` | `asc` or `desc`; omitted = `desc` for `date`, `asc` otherwise. Ties fall back to newest activity |
| `page`, `page_size` | 1-based page, size 1–100 (default 20) |

Response: `{orders, page, page_size, total}`. Each order carries its lines, `record_number`,
`total_cents` and `usage_months` — algorithm D, only for GIVEN orders: days since
`given_at` / 30.44, rounded to one decimal.

`GET /api/v1/settings` returns `{timezone, currency}` so clients display dates in the zone
the filters use.

## Employee Confirmation and the Items Given Record (algorithm C, manual §3.6, §8)

### Staff routes (any authenticated)

| Route | |
| --- | --- |
| `POST /api/v1/orders/{id}/confirmation-link` | Open Employee Confirmation. ORDERED only (409 otherwise). Returns `{url, expires_at}` once; `url` is `API_PUBLIC_BASE_URL/confirm/<token>`. Earlier unused links for the order are revoked. TTL `API_CONFIRM_TTL` (default 7 days). |
| `POST /api/v1/orders/{id}/confirm-paper` | Record a signed paper Items Given Record: GIVEN with method `PAPER`, the actor as giver. Idempotent. |
| `GET /api/v1/orders/{id}/record` | View Record / Print Record. |

### Public routes (token only, rate-limited 20/min per IP)

The token travels in the JSON body, never in an API path, so the request logger cannot
record it. The web page URL carries it; the app sets `Referrer-Policy: no-referrer`.

| Route | |
| --- | --- |
| `POST /api/v1/confirmations/view` `{token}` | The locked receipt. Unknown, expired or revoked link on an ORDERED order → 410 "request a new link". Once the order is GIVEN, its links show the final record. |
| `POST /api/v1/confirmations/confirm` `{token, confirmed: true}` | Algorithm C. `confirmed` must be true (400). Locks the order row; if already GIVEN returns the existing record and writes nothing; otherwise stores the evidence, sets GIVEN (`given_at`, method `ELECTRONIC`, giver = the user who created the link), revokes other unused links, writes `order.given` (no actor: public action). |

Only `sha256(token)` is stored. At most one confirmation per order carries evidence
(partial unique index), so concurrent confirmations cannot both succeed.

### Receipt and document hash

`order.ReceiptOf` builds the receipt **only from the snapshot**: record number, employee
name and code, ordered date, preparer, lines (item, details, size, quantity, unit price,
line total, currency, service period), total, and the English and Russian confirmation
texts with their `text_version`. `document_hash` is SHA-256 of its canonical JSON and is
stored as evidence; the record of a GIVEN order returns the stored hash. Changing the
wording (`order/receipt.go`) requires a new `ReceiptTextVersion`.

**Open item:** the Russian confirmation wording is a draft pending approval.

The web app renders the record in `components/receipt.tsx`; A4 print mode hides app
chrome and adds *Employee name and surname / Имя и фамилия работника*, *Signature /
Подпись* and *Date / Дата* lines. Every price shows €.
