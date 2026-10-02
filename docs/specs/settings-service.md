# Settings service

The organisation's settings that administrators change in the app, one set for the
whole organisation: `internal/domain/settings`, routes in `cmd/api/settings-routes.go`,
table `app_settings` (migration 0018). Settings fixed at deployment (the timezone, the
currency) stay in config; `GET /api/v1/settings` returns both kinds together.

| Route | Access |
| --- | --- |
| `GET /api/v1/settings` | any authenticated: `{timezone, currency, supplier_chat}`, `supplier_chat` being `{name, link}` or `null` when not set |
| `PUT /api/v1/settings/supplier-chat` | admin: body `{name, link}`, both set or both empty to clear; returns the settings |

In the web app they are the Settings screen (`/settings`), in the administrator's
navigation after Users; anyone else asking for `/settings` gets their own start screen.

## The supplier's WhatsApp group

Copy for WhatsApp copies an order message for the supplier. WhatsApp has no link that
opens a group with a message typed in: `wa.me/<number>?text=` reaches one person, and a
group's invite link (`https://chat.whatsapp.com/<code>`) takes no text. So the app
copies the message and, when the group is set, offers to open it by its invite link
("Open Superman Rubai Group"); staff paste the message there. Unset, WhatsApp opens with
the message and staff pick the chat.

It applies to order messages only: Create Order's review, the screen after Mark as
Ordered, and an ORDERED order in Orders. Sharing an employee's confirmation link and a
GIVEN order's Share via WhatsApp still let the user pick the chat.

- `name` is trimmed with inner spaces collapsed, at most 100 characters; it is what staff see.
- `link` must be a group invite link: `http`/`https`, host `chat.whatsapp.com`, a path of one
  10–40 character alphanumeric code, no user info. It is stored as
  `https://chat.whatsapp.com/<code>`, without what WhatsApp appends when the link is
  copied (`?mode=…`). Anything else, a person's `wa.me` link included, is `ErrInvalid` (400).
- A name needs a link and a link needs a name; both empty clears the group.
- Every signed-in user can read the link, since anyone preparing orders opens the group;
  an invite link lets whoever holds it join the group, so it is never put in the code or
  the client bundle.

## Storage and audit

`app_settings` holds one row at most (`singleton BOOLEAN PRIMARY KEY CHECK (singleton)`).
No row reads as the defaults (no group), so a database emptied by
`TRUNCATE users CASCADE`, which takes the row with its `updated_by_user_id`, still works.
The first save inserts the row (`ON CONFLICT (singleton) DO UPDATE` for two at once);
later ones lock it `FOR UPDATE`. A save that changes the group records
`settings.supplier_chat_changed` with the old and new `{name, link}`, entity type
`settings` and a fixed entity id (`settings.AuditEntityID`); an unchanged save writes
nothing.
