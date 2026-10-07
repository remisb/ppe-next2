-- The Audit log (docs/specs/audit-service.md): indexes for reading the trail
-- by time, person and event, and the context each change was made in.
--
-- request_id, session_id and source are recorded from this migration on;
-- older rows keep NULL there, meaning "not recorded". session_id names a row
-- of user_sessions without a foreign key: ended sessions are deleted after 30
-- days, and the event must outlive them.
ALTER TABLE audit_events
    ADD COLUMN request_id TEXT CHECK (request_id <> '' AND length(request_id) <= 64),
    ADD COLUMN session_id UUID,
    ADD COLUMN source     TEXT CHECK (source IN ('workwear', 'admin', 'api', 'public_link', 'system'));

CREATE INDEX audit_events_time_idx  ON audit_events (occurred_at DESC, id DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_event_idx ON audit_events (event, occurred_at DESC, id DESC);

-- Reading the Audit log is a permission of its own; the built-in
-- Administrator holds every administration permission (role.builtins).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'audit.read')
ON CONFLICT DO NOTHING;
