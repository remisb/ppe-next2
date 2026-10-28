# Mail template service

The templates of the emails the app prepares, and the rendering that turns one into an
email: `internal/domain/mailtemplate`, routes in `cmd/api/mail-template-routes.go`,
table `mail_templates` (migration 0040). Administrators edit them on **Mail Templates**
in Administration (`/admin/mail-templates`, `web/apps/admin/src/routes/mail-templates.tsx`).

**Nothing is sent.** The service only produces a recipient, a Cc, a subject and a body.
The screen that uses them shows each with Copy, and a **Send Email** link (`mailto:`) opens
the user's own mail app with them filled in, for the user to send from there. There is no
mail server, queue or integration, internal or external.

## Use cases

A **use case** is one place in the app that prepares an email. It has one template, so
administrators edit a template or put its default back, and never add or delete one. The
use cases are a fixed list in code (`usecase.go`, `UseCases()`), in the editor's order:

| Key | Used by | Default To | Default subject |
| --- | --- | --- | --- |
| `sim.activation` | Prepare Activation Email on a SIM card that is not Active (Company Assets) | `{{provider.email}}` | `SIM activation request - {{sim.number}}` |
| `sim.blocking` | Prepare Blocking Email on a SIM card that is not Blocked, and after Mark as Not Returned | `{{provider.email}}` | `SIM blocking request - {{sim.phone_number}}` |

The defaults are in English, which the providers read. The blocking default is the brief's
§14 text. The company's name comes from `{{company.name}}`, and the message ends with the
name of the user who prepares it.

Each use case lists the **fields** its caller fills in. Each field has a key, a label and a
sample. The label is what a missing value shows as, in brackets. The sample is what the
editor's preview fills in. Both SIM use cases have these fields:

| Field | Value | Label |
| --- | --- | --- |
| `sim.number` | the card's SIM number | SIM Number |
| `sim.phone_number` | its phone number | Phone Number |
| `sim.inventory_number` | its inventory number | Inventory Number |
| `sim.plan` | its plan, or for a card without one its provider's default plan on Settings, which Give SIM fills in | Plan |
| `provider.name` | its provider, as the card records it | Provider |
| `provider.email` | that provider's e-mail on Settings ([settings-service.md](settings-service.md)) | Provider E-mail |
| `employee.name` | who holds it; empty when no one does | Employee |
| `company.name` | the company's name on Settings | Company Name |
| `user.name` | the signed-in user preparing the email | Your Name |
| `user.email` | that user's e-mail, for a copy to themself | Your E-mail |
| `today` | the day, in `API_ORG_TIMEZONE` (YYYY-MM-DD) | Date |

## Templates

A template has four parts: **To**, **Cc** (who gets a copy; empty for no one, the
defaults' choice), **Subject** and **Message** (the body). A part writes a
field as `{{key}}`, and spaces inside the braces are ignored (`{{ sim.number }}`). The
syntax is the parser in `template.go`, not `text/template`: there is no logic and nothing to
escape.

On save (`TextParams.Validate`):

- To, Cc and Subject are trimmed. The body loses its `\r` and the trailing space of each line
  and of the whole.
- Each part but Cc is required, and each is kept within its limit: To and Cc 500,
  Subject 300, the body 10 000 characters. To, Cc and Subject must be one line. To and Cc
  may hold several addresses, separated by commas.
- Every `{{…}}` must name one of the use case's fields. A `{{` without its `}}`, or a field the
  use case does not have, is `ErrInvalid` (400) and names the part and the field
  (`body uses an unknown field {{sim.colour}}`). A lone `}}` is text.
- An unknown key is `ErrNotFound` (404). An unchanged save writes nothing.

**Reset** is saving the default. On the screen, **Use Default Text** puts the default in
the form, and **Save** keeps it. A use case that was never saved reads as its default
(`is_default`, with `updated_at` null).

## Rendering

`Service.Render(ctx, key, values)` is the call other parts of the app make. It reads the
template, or the default, and fills each field from `values`, a map from field key to value.
Values for other keys are ignored. The editor's preview shows the samples, never a real
card's values. It returns `Message{to, cc, subject, body, missing}`:

- A value is trimmed. In To, Cc and Subject its spaces and line breaks are collapsed, so a
  value never breaks those parts onto two lines.
- A field without a value renders as its label in brackets, such as `[Phone Number]`, for
  the user to fill in, and its key goes in `missing`. Each key is listed once, in the order
  it first appears.

`Service.Preview(key, text)` validates unsaved text and renders it with the samples. Nothing
is saved.

A domain that prepares an email declares the interface it needs. No domain imports
another. The composition root adapts this service to that interface, adding values the
domain does not hold. Company Assets declares `asset.Mailer`. `assetMailer` in
`cmd/api/checkers.go` answers it with the provider's e-mail and the company's name from
Settings, and the user's name and e-mail from the user service.

**Send Email** is `mailtoHref` in `web/apps/workwear/src/lib/assets.ts`, a `mailto:` link
(RFC 6068). It puts the addresses of To in the path and those of Cc in `cc=`, then
`subject=` and `body=`, all percent-encoded, with the body's line breaks as CRLF. A part
that is not an address, such as `[Provider E-mail]`, is left out for the user to fill in in
the mail app. The first Send Email or copy of each opening records the email as prepared.

## Routes

| Route | Access |
| --- | --- |
| `GET /api/v1/mail-templates` | `mail_templates.manage`: every use case's template, in order: `{key, to, cc, subject, body, fields: [{key, label, sample}], default: {to, cc, subject, body}, is_default, entity_id, updated_at, updated_by_user_id}` |
| `GET /api/v1/mail-templates/{key}` | `mail_templates.manage`: one template, as above; 404 for an unknown key |
| `PUT /api/v1/mail-templates/{key}` | `mail_templates.manage`: body `{to, cc, subject, body}` (`cc` empty or absent for no one); returns the template; 400 names what cannot be saved |
| `POST /api/v1/mail-templates/{key}/preview` | `mail_templates.manage`: body `{to, cc, subject, body}`; returns `{to, cc, subject, body, missing}` with the samples; saves nothing |

The emails themselves are prepared where they are used. A SIM card's are
`GET /api/v1/assets/{id}/emails/{activation|blocking}` (`assets.manage`), which records
nothing. `POST …/copied` records that one was copied ([asset-service.md](asset-service.md)).

**Change Mail Templates** (`mail_templates.manage`, group Administration) is granted to
Administrator by migration 0040. It opens the Mail Templates screen, which lists each use
case's template (Default text, or Changed and when). A template opens at
`/mail-templates/<key>` with:

- To, Cc, Subject and Message;
- **Fields**: clicking one puts it where the cursor was, in the part last typed in;
- a **Preview** with the samples, asked for again once typing pauses;
- Save, Discard changes and Use Default Text;
- its **Changes**, for whoever may read the Audit log.

The editing rules are `web/apps/admin/src/lib/mail-templates.ts`.

## Storage and audit

`mail_templates` holds one row per use case once it has been saved:

- `key` is the primary key, and `id` is unique, `mailtemplate.EntityID(key)`, a UUID made
  from the key.
- `recipient`, `subject` and `body` each carry a CHECK that keeps them set and within their
  limits; `cc` is `''` for no one, within its limit.
- `updated_at`, and `updated_by_user_id`, which references `users`.

`TRUNCATE users CASCADE` empties the table, and every template then reads as its default.
The first save inserts the row (`ON CONFLICT (key) DO UPDATE` when two saves meet); later
saves lock it `FOR UPDATE`.

A change records `mail_template.changed`:

- before and after are `{recipient, cc, subject, body}`;
- the entity type is `mail_template` and the entity id is the row's `id`;
- the Audit log lists it under Settings, names it by its use case, and links it to its
  editor.

## Adding a use case

1. Add its key, fields and default to `useCases` in `usecase.go`, and the key to
   `MailTemplateKey` (`@ppe/api-client`) and to `mailTemplateKeys` (Administration's router).
2. Give it a name, its "used by" line and any new fields' descriptions in Administration's
   `mailTemplates` dictionaries (EN/LT/RU).
3. In the domain that prepares it, declare an interface and adapt `Render` to it in
   `cmd/api/checkers.go`, as `assetMailer` does. Add the screen that shows the email with Copy.
4. Add a line to the table above and to `docs/testing.md`.
