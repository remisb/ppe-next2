-- The API's least-privilege role, ppe_app, and what it may do (ADR 0003,
-- migration 0026). Applied after the migrations on every run of `make migrate`
-- and deploy/migrate.sh, so it holds after a restore (pg_restore --no-acl
-- drops grants) and covers every table. Every statement is idempotent.
--
-- It reads and writes the business tables and uses their sequences; only
-- INSERTs and SELECTs the trails (audit_events, auth_events, audit_seals,
-- audit_purges, order_lines), which it purges only through the owner's
-- functions; only reads what others write (schema_migrations, the backup
-- agent's tables); reads the statistics System shows; truncates, alters and
-- creates nothing. A new trail table belongs in the REVOKE below.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ppe_app') THEN
        CREATE ROLE ppe_app NOLOGIN;
    END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO ppe_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ppe_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ppe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ppe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ppe_app;
REVOKE UPDATE, DELETE ON audit_events, auth_events, audit_seals, audit_purges, order_lines FROM ppe_app;
REVOKE INSERT, UPDATE, DELETE ON schema_migrations, dbbackup_runs, dbbackup_agents FROM ppe_app;
REVOKE EXECUTE ON FUNCTION purge_audit_events(TIMESTAMPTZ), purge_auth_events(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_audit_events(TIMESTAMPTZ), purge_auth_events(TIMESTAMPTZ) TO ppe_app;
-- Other sessions' state on System (connections, the oldest transaction).
GRANT pg_read_all_stats TO ppe_app;
