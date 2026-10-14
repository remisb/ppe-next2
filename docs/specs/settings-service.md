# Settings service

The organisation's settings that administrators change in the app, one set for the
whole organisation: `internal/domain/settings`, routes in `cmd/api/settings-routes.go`,
table `app_settings` (migration 0018). Settings fixed at deployment (the timezone, the
currency) stay in config; `GET /api/v1/settings` returns both kinds together.

| Route | Access |
| --- | --- |
| `GET /api/v1/settings` | any authenticated: `{timezone, currency, supplier_chat, sim_providers, default_sim_provider}`, `supplier_chat` being `{name, link}` or `null` when not set, `sim_providers` a list (empty when none), `default_sim_provider` one of them or `null` |
| `PUT /api/v1/settings/supplier-chat` | `settings.manage` (administrators): body `{name, link}`, both set or both empty to clear; returns the settings |
| `PUT /api/v1/settings/sim-providers` | `settings.manage` (administrators): body `{providers, default}`, `default` one of `providers` or `''` for none; returns the settings |

In the web app they are the Settings screen in Administration (`/admin/settings`); the
staff app's old `/settings` leads there.

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

## The SIM card providers

An administrator lists the SIM card providers on Settings and marks one as the default
(or none). Add SIM (Company Assets, [asset-service.md](asset-service.md)) offers them in
a select, the default one chosen; Edit offers them too, with the card's own provider added
when it is no longer listed. With none listed, the provider is typed, as before the list
existed, and the field says an administrator can list them.

- On the screen the list is a draft: **Add** (the first provider added becomes the default
  when there is none), **Remove** (removing the default leaves none), the **Default
  provider** radios with **No default**, then **Save providers** sends it all.
- Each provider is trimmed, as an asset's provider is, empty ones dropped, at most 100
  characters; one listed twice in any case, more than 50, or a default not among them is
  `ErrInvalid` (400). A default naming a listed provider in another case takes the list's
  spelling. The administrator's order is kept.
- The list only feeds the form: the API does not refuse a card whose provider is not
  listed, a card's provider is still its own, and changing the list changes no card.
- Stored in `app_settings.sim_providers` (`TEXT[]`, migration 0033) and
  `default_sim_provider` (migration 0031, `''` when none); a CHECK keeps the default among
  the providers. Migration 0033 began the list with the default and the providers of the
  SIM cards registered, one spelling each, where the settings row existed.
- Until 0033 the default was set from Add SIM (**Default for new cards**, `assets.manage`,
  `PUT /api/v1/settings/default-sim-provider`); that route is gone.

## Storage and audit

`app_settings` holds one row at most (`singleton BOOLEAN PRIMARY KEY CHECK (singleton)`).
No row reads as the defaults (no group), so a database emptied by
`TRUNCATE users CASCADE`, which takes the row with its `updated_by_user_id`, still works.
The first save inserts the row (`ON CONFLICT (singleton) DO UPDATE` for two at once);
later ones lock it `FOR UPDATE`. A save that changes the group records
`settings.supplier_chat_changed` with the old and new `{name, link}`, entity type
`settings` and a fixed entity id (`settings.AuditEntityID`); one that changes the default
SIM card providers records `settings.sim_providers_changed` with the old and new
`{providers, default_provider}` (older events, `settings.default_sim_provider_changed`,
hold `{provider}`). An unchanged save writes nothing, and each save keeps the other setting.
