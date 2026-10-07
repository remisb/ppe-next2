-- Security events (docs/specs/security-service.md, ADR 0003): sign-ins, failed
-- attempts and how sessions end, apart from the business trail in
-- audit_events. They hold the client's address, so they are kept only
-- API_AUTH_EVENTS_RETENTION (default 180 days) and then deleted by the API's
-- purge, the only way a row leaves this table.
CREATE TABLE auth_events (
    id            UUID PRIMARY KEY,
    occurred_at   TIMESTAMPTZ NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN (
        'sign_in', 'sign_in_failed', 'reauth', 'reauth_failed',
        'signed_out', 'session_ended', 'refresh_reused'
    )),
    -- The account: NULL for a failed sign-in naming an email nobody has.
    user_id       UUID REFERENCES users (id),
    -- Who made it happen when that was a signed-in user: the user ending their
    -- other devices, or an administrator ending someone's session.
    actor_user_id UUID REFERENCES users (id),
    -- The email a sign-in named, as an HMAC-SHA256 under a key derived from
    -- API_JWT_SECRET: attempts at one email group (and are limited) without
    -- the email typed being stored.
    email_hash    BYTEA CHECK (length(email_hash) = 32),
    -- The session concerned; no foreign key, as ended sessions are deleted
    -- after 30 days.
    session_id    UUID,
    -- Why a sign-in failed, or why a session ended (user_sessions.end_reason).
    reason        TEXT CHECK (reason IN (
        'unknown_email', 'bad_password', 'inactive', 'too_many_attempts',
        'signed_out', 'ended_elsewhere', 'ended_by_administrator', 'password_changed', 'password_reset',
        'deactivated', 'deleted', 'reused'
    )),
    ip            TEXT,
    user_agent    TEXT,
    request_id    TEXT CHECK (request_id <> '' AND length(request_id) <= 64),
    source        TEXT CHECK (source IN ('workwear', 'admin', 'api', 'public_link', 'system'))
);

CREATE INDEX auth_events_time_idx  ON auth_events (occurred_at DESC, id DESC);
CREATE INDEX auth_events_user_idx  ON auth_events (user_id, occurred_at DESC, id DESC) WHERE user_id IS NOT NULL;
-- The per-email sign-in limit reads an email's recent attempts.
CREATE INDEX auth_events_email_idx ON auth_events (email_hash, occurred_at DESC) WHERE email_hash IS NOT NULL;

-- Rows are never changed. A row is deleted only by the purge, which sets
-- ppe.purge_auth_events in its transaction, and never one younger than 30
-- days, the shortest retention the API accepts.
CREATE FUNCTION auth_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('ppe.purge_auth_events', true) = 'on'
            AND OLD.occurred_at < now() - interval '30 days' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'auth_events is append-only; only the purge deletes rows older than its retention';
END;
$$;

CREATE TRIGGER auth_events_guard
    BEFORE UPDATE OR DELETE ON auth_events
    FOR EACH ROW EXECUTE FUNCTION auth_events_guard();

-- The last sign-in outlives the events, for the access review. Before this
-- migration only the sessions knew it, and ended ones are kept 30 days.
ALTER TABLE users ADD COLUMN last_sign_in_at TIMESTAMPTZ;
UPDATE users u SET last_sign_in_at = (SELECT max(s.created_at) FROM user_sessions s WHERE s.user_id = u.id);

-- An administrator can end anyone's session from Security.
ALTER TABLE user_sessions DROP CONSTRAINT user_sessions_end_reason_known;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_end_reason_known CHECK (end_reason IN (
    'signed_out', 'ended_elsewhere', 'ended_by_administrator', 'password_changed', 'password_reset',
    'deactivated', 'deleted', 'reused'
));

-- The Security screen is a permission of its own; the built-in Administrator
-- holds every administration permission (role.builtins).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'security.read')
ON CONFLICT DO NOTHING;
