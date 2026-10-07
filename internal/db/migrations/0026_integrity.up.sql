-- Integrity and retention (ADR 0003 items 4–5, docs/specs/audit-service.md).
--
-- 1. Daily seals: after each day (UTC, an hour's grace), the API hashes that
--    day's audit events in (occurred_at, id) order into audit_seals, each seal
--    chained to the one before. Verify recomputes them.
-- 2. Retention: audit events older than API_AUDIT_RETENTION (default 10 years)
--    and security events older than API_AUTH_EVENTS_RETENTION are deleted only
--    by purge_audit_events and purge_auth_events, functions that run as the
--    owner and refuse recent rows. audit_purges records each audit purge.
-- 3. Least privilege: the role ppe_app (internal/db/grants.sql), which the API
--    connects as once it has a password (deploy/migrate.sh), may read and
--    write the business tables, but only INSERT and SELECT the trails, and
--    truncate nothing.
-- 4. A TRUNCATE guard on the trails; test setup sets ppe.allow_truncate.

CREATE TABLE audit_seals (
    day       DATE PRIMARY KEY,
    rows      INTEGER NOT NULL CHECK (rows >= 0),
    hash      BYTEA NOT NULL CHECK (length(hash) = 32),
    -- The previous day's seal's hash; NULL on the first seal.
    prev_hash BYTEA CHECK (length(prev_hash) = 32),
    sealed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE audit_purges (
    id         UUID PRIMARY KEY,
    -- Audit events that occurred before this day (UTC) were deleted.
    before_day DATE NOT NULL,
    rows       BIGINT NOT NULL CHECK (rows >= 0),
    purged_at  TIMESTAMPTZ NOT NULL
);

-- One append-only rule for every trail: rows are never changed or deleted,
-- except the purge of audit_events (below).
CREATE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER audit_seals_no_update_delete BEFORE UPDATE OR DELETE ON audit_seals
    FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER audit_purges_no_update_delete BEFORE UPDATE OR DELETE ON audit_purges
    FOR EACH ROW EXECUTE FUNCTION append_only();

-- audit_events: a DELETE is allowed only inside purge_audit_events, and never
-- of a row younger than a year, the shortest retention the API accepts.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('ppe.purge_audit_events', true) = 'on'
            AND OLD.occurred_at < now() - interval '365 days' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_events is append-only; only the purge deletes rows older than its retention';
END;
$$;

-- The purges run as the owner (SECURITY DEFINER), so ppe_app needs no DELETE
-- on the trails. Each refuses a boundary closer than the trigger allows.
CREATE FUNCTION purge_audit_events(boundary TIMESTAMPTZ) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n BIGINT;
BEGIN
    IF boundary > now() - interval '365 days' THEN
        RAISE EXCEPTION 'audit events are kept at least 365 days';
    END IF;
    PERFORM set_config('ppe.purge_audit_events', 'on', true);
    DELETE FROM audit_events WHERE occurred_at < boundary;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('ppe.purge_audit_events', 'off', true);
    RETURN n;
END;
$$;

CREATE FUNCTION purge_auth_events(boundary TIMESTAMPTZ) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n BIGINT;
BEGIN
    IF boundary > now() - interval '30 days' THEN
        RAISE EXCEPTION 'security events are kept at least 30 days';
    END IF;
    PERFORM set_config('ppe.purge_auth_events', 'on', true);
    DELETE FROM auth_events WHERE occurred_at < boundary;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('ppe.purge_auth_events', 'off', true);
    RETURN n;
END;
$$;

-- TRUNCATE skips row triggers, so the trails get a statement trigger too.
-- Test setup, which empties the database, says so first:
--   SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE
CREATE FUNCTION refuse_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('ppe.allow_truncate', true) = 'on' THEN
        RETURN NULL;
    END IF;
    RAISE EXCEPTION '% may not be truncated', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER audit_events_no_truncate  BEFORE TRUNCATE ON audit_events  FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
CREATE TRIGGER auth_events_no_truncate   BEFORE TRUNCATE ON auth_events   FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
CREATE TRIGGER audit_seals_no_truncate   BEFORE TRUNCATE ON audit_seals   FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
CREATE TRIGGER audit_purges_no_truncate  BEFORE TRUNCATE ON audit_purges  FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
CREATE TRIGGER order_lines_no_truncate   BEFORE TRUNCATE ON order_lines   FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

-- The API's role ppe_app and what it may do are in internal/db/grants.sql,
-- applied after the migrations on every run (`make migrate`, deploy/migrate.sh):
-- a restore (pg_restore --no-acl) drops grants, and the next migrate puts
-- them back.

-- Exporting the Audit log is a permission of its own; the built-in
-- Administrator holds every administration permission (role.builtins).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'audit.export')
ON CONFLICT DO NOTHING;
