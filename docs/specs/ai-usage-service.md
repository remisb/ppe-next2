# AI usage service

Every call the app makes to an AI model, and what it cost: one row per call, a monthly
budget, and Administration's **AI Usage** screen. Also where the OpenAI key and the AI
settings live. Decision 8 of
[ADR 0007](../architecture/adr/0007-personnel-files-identity-documents.md); the docs-import
plan's FR-21 and section 5.8. The first and, for now, only operation is the colour photo of
[personnel-service.md](personnel-service.md).

- **Package:** `internal/aiusage` (platform, like `internal/usage`): the ledger, prices,
  budget and the operations' list. The OpenAI client is `cmd/api/openai.go`, the only code that
  talks to OpenAI; it writes a row for every call, so no caller can forget one.
- **Migrations:** the next free number (0049 is SIM cards' permissions), `…_ai_usage` (the table, its append-only grants, the settings columns,
  `ai_usage.read`), planned.

## Operations

A fixed list in code, as mail templates' use cases are (`aiusage.Operations()`, mirrored in
`@ppe/api-client`'s `AI_OPERATIONS`, a test keeps them equal). Each names the business action,
not the model call:

| Operation | Context | What |
| --- | --- | --- |
| `portrait.colorize` | Personnel files | Make Colour Photo (AI) on a document's portrait |

A new AI feature adds its operation here first.

## The ledger (`ai_usage`)

| Column | Notes |
| --- | --- |
| `id`, `at` | |
| `operation` | from the list above (a CHECK) |
| `provider`, `model` | `openai`, `gpt-image-2` |
| `outcome` | `ok`; `failed` (OpenAI or the network refused, with `error_code`, OpenAI's code or `timeout`); `refused` (the app refused before calling: budget spent, switch off, no key) |
| `input_text_tokens`, `input_image_tokens`, `output_text_tokens`, `output_image_tokens` | as OpenAI's `usage` reports them; 0 when it reports none |
| `cost_micro_usd` | the tokens times `prices`, rounded up to a micro-dollar |
| `prices` | the price table's row for the model when the call was made (USD per 1M tokens of each kind), so changing prices never rewrites history |
| `duration_ms` | |
| `user_id`, `source`, `request_id` | who, from which app (`X-PPE-App`), which request (as on its log lines) |
| `provider_request_id` | OpenAI's `x-request-id`, to match their bill |
| `employee_id` | whose portrait, when the operation has one; cleared when that person's file is shredded |

No prompt, image, answer or other content is ever stored. The table is append-only for
`ppe_app` (its REVOKE line in `grants.sql`), except `clear_ai_usage_employee(employee)`, an
owner's `SECURITY DEFINER` function the shredding job calls. Rows are kept 10 years, like the
audit trail, then purged by the same job.

## Cost and budget

- **Prices** are a table in Settings, per model: text input, image input, text output, image
  output, in USD per million tokens. The code's defaults are OpenAI's list prices when it is
  written (`gpt-image-2`: text input $5, image input $8, image output $30, to be checked
  against OpenAI's pricing page then); an administrator changes them when OpenAI does
  (`settings.ai_prices_changed`). A model with no prices is refused (`refused`, `no_prices`).
- **Budget**: a monthly amount in USD, or none. Before every call the month's cost so far (in
  the organisation's timezone) is summed; at or over the budget the call is refused (429,
  `ErrAIBudgetSpent`) and recorded as `refused`. The Overview tells `settings.manage` at 80 %
  and at 100 %.
- **Rate limit**: per user and operation, 20 calls an hour by default, then 429.

## Settings → AI

On Administration's Settings, an **AI** section (`settings.manage`); in `app_settings`:

| Setting | Notes |
| --- | --- |
| OpenAI API key | sealed with `API_SECRETS_KEY`'s keyring, bound to `"ppe.settings.openai_key.v1"`; never returned. The screen shows "Set, ends in …4f2a, by <user>, <date>" with **Replace**, **Remove** and **Test** (a call to OpenAI's model list, which costs nothing and records no row). Setting or removing it needs a recent sign-in; `settings.ai_key_set` and `settings.ai_key_removed` name the last four characters only. A project key limited to the image endpoints, with a spending limit at OpenAI too, is recommended beside the field |
| Model | `gpt-image-2` by default; a model OpenAI no longer has fails the calls (`failed`, `model_not_found`) and the Overview says so |
| Quality | `low`, `medium` (default) or `high`: OpenAI's, the main driver of cost |
| Prices | as above |
| Monthly budget | USD, or empty for none |
| **AI colour photos** | the switch; off by default |

Each change is audited (`settings.ai_changed` with the before and after of everything but the
key). Without `API_SECRETS_KEY` the key cannot be saved, and the section says why.

## Routes

| Route | Permission | Notes |
| --- | --- | --- |
| `GET /api/v1/settings/ai` | `settings.manage` | the settings, the key's state, never the key |
| `PUT /api/v1/settings/ai` | `settings.manage` | model, quality, prices, budget, switch |
| `PUT /api/v1/settings/ai/key` | `settings.manage`, recent sign-in | `{"key": "sk-…"}`; checked with Test before it is saved |
| `DELETE /api/v1/settings/ai/key` | `settings.manage`, recent sign-in | |
| `POST /api/v1/settings/ai/key/test` | `settings.manage` | the saved key against OpenAI's model list |
| `GET /api/v1/ai-usage` | `ai_usage.read` | totals: by month, and within a period by operation, user and model; this month against the budget |
| `GET /api/v1/ai-usage/calls` | `ai_usage.read` | the rows, newest first, filtered by period, operation, user, outcome; paged |
| `GET /api/v1/ai-usage/calls.csv` | `ai_usage.read` | the same as CSV |

`ai_usage.read` is in the Administration group, held by the built-in Administrator.

## AI Usage screen

Administration, under Usage: this month's cost against the budget, cost and calls per month
(the Usage screen's charts, `@ppe/ui/components/charts`), the same split by operation, user and
model, and the calls (when, who, operation, model, tokens, cost, outcome), filtered and exported.
Costs are in USD, as OpenAI bills; the screen says the figures are the app's own estimate from
its price table, and that OpenAI's invoice is the bill.

## Tests

- Cost: tokens × prices, rounding, a missing price; the row keeps the prices it used.
- Budget: a call at the budget is refused and recorded `refused`; a new month starts again.
- The client: against a fake OpenAI server, a success records the reported tokens, a 4xx or a
  timeout records `failed` with whatever usage came back, and the key never appears in a log
  line, error, event or row.
- Route policy for every route; the key's routes need a recent sign-in.
- Postgres: append-only for `ppe_app`; `clear_ai_usage_employee` clears only that column.
