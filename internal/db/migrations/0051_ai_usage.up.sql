-- AI usage (ADR 0007, decision 8; docs/specs/ai-usage-service.md): every call
-- the app makes to an AI model, what it cost, who and when; Settings → AI with
-- the company's OpenAI key, sealed; and the AI-coloured employee photo.

-- Settings → AI: one row at most. The key is sealed by the API under
-- API_SECRETS_KEY (internal/sealbox), which the database never holds; only
-- its last four characters are kept readable, to say which key it is.
CREATE TABLE ai_settings (
    one                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (one),
    enabled              BOOLEAN NOT NULL DEFAULT false,
    model                TEXT NOT NULL DEFAULT 'gpt-image-2' CHECK (model ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
    quality              TEXT NOT NULL DEFAULT 'medium' CHECK (quality IN ('low', 'medium', 'high')),
    -- USD per million tokens of each kind, by model: {"gpt-image-2": {"input_text": 5, …}}.
    prices               JSONB NOT NULL DEFAULT '{}',
    -- The monthly budget in micro-dollars; null is none.
    budget_micro_usd     BIGINT CHECK (budget_micro_usd >= 0),
    key_sealed           BYTEA CHECK (octet_length(key_sealed) BETWEEN 29 AND 600),
    key_id               SMALLINT CHECK (key_id >= 1),
    key_last4            TEXT CHECK (length(key_last4) = 4),
    key_set_at           TIMESTAMPTZ,
    key_set_by_user_id   UUID REFERENCES users (id),
    updated_at           TIMESTAMPTZ NOT NULL,
    updated_by_user_id   UUID NOT NULL REFERENCES users (id),
    CHECK ((key_sealed IS NULL) = (key_id IS NULL) AND (key_sealed IS NULL) = (key_last4 IS NULL))
);

-- The ledger: one row a call, never the prompt, image or answer. Append-only
-- for ppe_app (grants.sql), but for clear_ai_usage_employee.
CREATE TABLE ai_usage (
    id                   UUID PRIMARY KEY,
    at                   TIMESTAMPTZ NOT NULL,
    operation            TEXT NOT NULL CHECK (operation IN ('portrait.colorize')),
    provider             TEXT NOT NULL CHECK (provider ~ '^[a-z0-9_-]{1,32}$'),
    model                TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 64),
    outcome              TEXT NOT NULL CHECK (outcome IN ('ok', 'failed', 'refused')),
    error_code           TEXT CHECK (length(error_code) <= 64),
    input_text_tokens    INTEGER NOT NULL DEFAULT 0 CHECK (input_text_tokens >= 0),
    input_image_tokens   INTEGER NOT NULL DEFAULT 0 CHECK (input_image_tokens >= 0),
    output_text_tokens   INTEGER NOT NULL DEFAULT 0 CHECK (output_text_tokens >= 0),
    output_image_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (output_image_tokens >= 0),
    cost_micro_usd       BIGINT NOT NULL CHECK (cost_micro_usd >= 0),
    prices               JSONB NOT NULL,
    duration_ms          INTEGER NOT NULL CHECK (duration_ms >= 0),
    user_id              UUID NOT NULL REFERENCES users (id),
    source               TEXT NOT NULL CHECK (source ~ '^[a-z][a-z0-9_-]{1,30}$'),
    request_id           TEXT NOT NULL,
    provider_request_id  TEXT CHECK (length(provider_request_id) <= 128),
    employee_id          UUID REFERENCES employees (id)
);
CREATE INDEX ai_usage_at_idx ON ai_usage (at DESC);
CREATE INDEX ai_usage_employee_idx ON ai_usage (employee_id) WHERE employee_id IS NOT NULL;

-- When a person's personnel file is shredded (D3), their calls keep their
-- cost and lose their employee: the only change the ledger allows.
CREATE FUNCTION clear_ai_usage_employee(employee UUID) RETURNS BIGINT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    WITH cleared AS (UPDATE ai_usage SET employee_id = NULL WHERE employee_id = employee RETURNING 1)
    SELECT count(*) FROM cleared
$$;

-- An AI-coloured employee photo is marked so everywhere, carries the
-- person's consent (who, when, how), and is never the ID badge's (PR-6, PR-7).
ALTER TABLE employee_photos
    ADD COLUMN ai_generated BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN consent JSONB,
    ADD CONSTRAINT employee_photos_ai_consent CHECK (NOT ai_generated OR consent IS NOT NULL),
    ADD CONSTRAINT employee_photos_ai_not_badge CHECK (NOT (ai_generated AND 'id_badge' = ANY (uses)));

-- See AI Usage, the Administrator's (role.AdminID). A database whose roles are
-- not installed yet gets it with them (role.EnsureBuiltins).
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'ai_usage.read' FROM roles WHERE id = 'a0e1d000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;
