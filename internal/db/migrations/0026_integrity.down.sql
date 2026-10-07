DELETE FROM role_permissions WHERE permission = 'audit.export';

-- ppe_app (internal/db/grants.sql) belongs to the cluster and keeps its rights
-- on the tables that remain; the next `make migrate` applies grants.sql again.

DROP TRIGGER order_lines_no_truncate ON order_lines;
DROP TRIGGER audit_events_no_truncate ON audit_events;
DROP TRIGGER auth_events_no_truncate ON auth_events;
DROP TABLE audit_purges;
DROP TABLE audit_seals;
DROP FUNCTION refuse_truncate();
DROP FUNCTION purge_auth_events(TIMESTAMPTZ);
DROP FUNCTION purge_audit_events(TIMESTAMPTZ);
DROP FUNCTION append_only();

CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
