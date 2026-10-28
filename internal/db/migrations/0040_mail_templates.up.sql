-- The templates of the emails the app prepares (internal/domain/mailtemplate):
-- one row per use case (sim.activation, sim.blocking) once an administrator
-- has saved it; a use case without a row reads as its default, kept in code.
-- Nothing is sent: the user copies the rendered email into their own.
CREATE TABLE mail_templates (
    key                TEXT PRIMARY KEY CONSTRAINT mail_templates_key_check CHECK (key <> ''),
    -- The id its audit events are recorded under (mailtemplate.EntityID, made
    -- from the key), so the Audit log can name the template.
    id                 UUID NOT NULL UNIQUE,
    recipient          TEXT NOT NULL CONSTRAINT mail_templates_recipient_check CHECK (recipient <> '' AND char_length(recipient) <= 500),
    -- Who gets a copy; empty for no one.
    cc                 TEXT NOT NULL DEFAULT '' CONSTRAINT mail_templates_cc_length CHECK (char_length(cc) <= 500),
    subject            TEXT NOT NULL CONSTRAINT mail_templates_subject_check CHECK (subject <> '' AND char_length(subject) <= 300),
    body               TEXT NOT NULL CONSTRAINT mail_templates_body_check CHECK (body <> '' AND char_length(body) <= 10000),
    updated_at         TIMESTAMPTZ NOT NULL,
    updated_by_user_id UUID NOT NULL REFERENCES users (id)
);

-- Change Mail Templates, the Administrator's (role.AdminID).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'mail_templates.manage') ON CONFLICT DO NOTHING;
