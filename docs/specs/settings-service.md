# Settings service

The organisation's settings that administrators change in the app, one set for the
whole organisation: `internal/domain/settings`, routes in `cmd/api/settings-routes.go`,
table `app_settings` (migration 0018) and its `sim_providers` (migration 0039). Settings fixed at deployment (the timezone, the
currency) stay in config; `GET /api/v1/settings` returns both kinds together.

| Route | Access |
| --- | --- |
| `GET /api/v1/settings` | any authenticated: `{timezone, currency, company_name, supplier_chat, sim_providers, default_sim_provider, default_sim_non_return_value_cents}`, `company_name` text or `null` when not set, `supplier_chat` being `{name, link}` or `null` when not set, `sim_providers` a list (empty when none) of `{name, email, default_plan}` (each `''` when not set), `default_sim_provider` the name of one of them or `null`, `default_sim_non_return_value_cents` cents or `null` |
| `PUT /api/v1/settings/company` | `settings.manage` (administrators): body `{name}`, empty to clear; returns the settings |
| `PUT /api/v1/settings/supplier-chat` | `settings.manage` (administrators): body `{name, link}`, both set or both empty to clear; returns the settings |
| `PUT /api/v1/settings/sim-providers` | `settings.manage` (administrators): body `{providers: [{name, email, default_plan}], default, default_non_return_value_cents}`, `email` and `default_plan` `''` (or absent) for none, `default` the name of one of `providers` or `''` for none, the value in cents or `null` (or absent) for none; returns the settings |

In the web app they are the Settings screen in Administration (`/admin/settings`); the
staff app's old `/settings` leads there.

## The company

The company's name, which mail templates write where they use `{{company.name}}`
([mail-template-service.md](mail-template-service.md)), as the SIM activation and
blocking emails do. It is trimmed with inner spaces collapsed, at most 200 characters, or
empty for none; a CHECK keeps the length. Unset, an email shows `[Company Name]` for the user
to fill in, and the sheet says Settings has none. Stored in `app_settings.company_name`
(migration 0039); a change records `settings.company_changed` with the old and new `{name}`.
On the screen it is the **Company** card, first on Settings.

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

## The SIM providers

An administrator lists the SIM providers on Settings and marks one as the default
(or none). Add SIM (Company Assets, [asset-service.md](asset-service.md)) offers them in
a select, the default one chosen; Edit offers them too, with the card's own provider added
when it is no longer listed. With none listed, the provider is typed, as before the list
existed, and the field says an administrator can list them.

- On the screen the list is a draft: **Add** (the first provider added becomes the default
  when there is none), **Remove** (removing the default leaves none), the **Default
  provider** radios with **No default**, each provider's **E-mail** and **Default plan**,
  the **Default Non-return Value (€)**, then **Save** sends it all.
- A provider's **e-mail** is where its SIM activation and blocking emails go
  (`{{provider.email}}`, [mail-template-service.md](mail-template-service.md)). It is
  trimmed; one bare address with a dot in its domain (`net/mail`, no display name, no list),
  at most 254 characters, or `''` for none; anything else is `ErrInvalid` (400). Unset, the
  email's To shows `[Provider E-mail]`, and the sheet says the provider has none.
- The default Non-return Value is what Add SIM fills in for a new card's Non-return Value
  (the field stays editable, and may be emptied). It is cents from 0 to 10 000 000 000, an
  asset's own limit, or none; out of range is `ErrInvalid` (400), and a CHECK keeps it so.
  Typed in euros on Settings (`25`, `25,00`, `€25`), shown with two decimals. Changing it
  changes no card already registered.
- A provider's **default plan** is what Add SIM fills in for a new card of that provider
  (and again when another provider is chosen, while the plan is empty or still the
  previous provider's), and Give SIM for the plan of its card that has none of its own (the
  field stays editable, and may be emptied; a card's own plan is never replaced). A card
  whose provider is not listed gets none.
  Trimmed, at most 100 characters, a SIM card's plan's own limit, or `''` for none; longer
  is `ErrInvalid` (400), and a CHECK keeps it so. Changing it changes no card. Until
  migration 0039 there was one default plan for every provider (`default_sim_plan`); 0039
  gave it to each provider listed.
- Each provider is trimmed, as an asset's provider is, empty ones dropped, at most 100
  characters; one listed twice in any case, more than 50, or a default not among them is
  `ErrInvalid` (400). A default naming a listed provider in another case takes the list's
  spelling. The administrator's order is kept.
- The list only feeds the form: the API does not refuse a card whose provider is not
  listed, a card's provider is still its own, and changing the list changes no card.
- Stored in the table `sim_providers` (migration 0039: `position`, `name` unique in any
  case, `email`, `default_plan`), whose rows belong to the settings row
  (`REFERENCES app_settings ON DELETE CASCADE`, so emptying it empties them) and are
  written again, all of them, under its lock when the list changes;
  `app_settings.default_sim_provider` (migration 0031, `''` when none) and
  `default_sim_non_return_value_cents` (`BIGINT`, migration 0034, `NULL` when none). The
  service keeps the default among the providers. Before 0039 the list was
  `app_settings.sim_providers` (`TEXT[]`, migration 0033, begun with the default and the
  providers of the SIM cards registered), with a CHECK keeping the default in it.
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
SIM providers records `settings.sim_providers_changed` with the old and new
`{providers, default_provider, default_non_return_value_cents}`, each provider
`{name, email, default_plan}` (events before migration 0039 list the providers by name with
one `default_plan` for all, before 0034 lack the value, before 0035 the plan; older ones,
`settings.default_sim_provider_changed`, hold `{provider}`); one that changes the company
records `settings.company_changed` with `{name}`. An unchanged save writes nothing, and each save keeps the other setting.
