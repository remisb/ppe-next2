# Settings service

The organisation's settings that administrators change in the app, one set for the
whole organisation: `internal/domain/settings`, routes in `cmd/api/settings-routes.go`,
table `app_settings` (migration 0018). Settings fixed at deployment (the timezone, the
currency) stay in config; `GET /api/v1/settings` returns both kinds together.

| Route | Access |
| --- | --- |
| `GET /api/v1/settings` | any authenticated: `{timezone, currency, supplier_chat, default_sim_provider}`, `supplier_chat` being `{name, link}` or `null` when not set, `default_sim_provider` a string or `null` |
| `PUT /api/v1/settings/supplier-chat` | `settings.manage` (administrators): body `{name, link}`, both set or both empty to clear; returns the settings |
| `PUT /api/v1/settings/default-sim-provider` | `assets.manage` (whoever registers SIM cards): body `{provider}`, empty to clear; returns the settings |

In the web app they are the Settings screen in Administration (`/admin/settings`); the
staff app's old `/settings` leads there. The default SIM card provider is set where it is
used, on Add SIM Card.

## The supplier's WhatsApp group

Copy for WhatsApp copies an order message for the supplier. WhatsApp has no link that
opens a group with a message typed in: `wa.me/<number>?text=` reaches one person, and a
group's invite link (`https://chat.whatsapp.com/<code>`) takes no text. So the app
copies the message and, when the group is set, offers to open it by its invite link
("Open Superman Rubai Group"); staff paste the message there. Unset, WhatsApp opens with
the message and staff pick the chat.

It applies to the order message, which is sent from Create Order's review only (neither
the screen after Mark as Ordered nor an order in Orders has Copy for WhatsApp). Sharing an employee's confirmation link and a
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

## The default SIM card provider

Add SIM Card (Company Assets, [asset-service.md](asset-service.md)) fills in the provider
with the default, when there is one. Below the field, **Default for new cards** is ticked
while the provider is the default one; ticking it for another provider makes that one the
default, and unticking it on the default one clears it, both as the card is saved (the
default first, so a refused default adds no card). Edit does not offer it.

- `provider` is trimmed, as an asset's provider is, at most 100 characters; empty clears it.
- It only fills in the form: a card's provider is still its own, and changing the default
  changes no card.
- Stored in `app_settings.default_sim_provider` (migration 0031), `''` when none.

## Storage and audit

`app_settings` holds one row at most (`singleton BOOLEAN PRIMARY KEY CHECK (singleton)`).
No row reads as the defaults (no group), so a database emptied by
`TRUNCATE users CASCADE`, which takes the row with its `updated_by_user_id`, still works.
The first save inserts the row (`ON CONFLICT (singleton) DO UPDATE` for two at once);
later ones lock it `FOR UPDATE`. A save that changes the group records
`settings.supplier_chat_changed` with the old and new `{name, link}`, entity type
`settings` and a fixed entity id (`settings.AuditEntityID`); one that changes the default
SIM card provider records `settings.default_sim_provider_changed` with the old and new
`{provider}`. An unchanged save writes nothing, and each save keeps the other setting.
