-- Append-only record of changes to prices, sizes, order statuses and
-- confirmations. Rows are written in the same transaction as the change they
-- describe and are never updated or deleted.
CREATE TABLE audit_events (
    id            UUID PRIMARY KEY,
    actor_user_id UUID REFERENCES users (id),  -- NULL only for public, token-authorised actions
    event         TEXT NOT NULL CHECK (event <> ''),
    entity_type   TEXT NOT NULL CHECK (entity_type <> ''),
    entity_id     UUID NOT NULL,
    occurred_at   TIMESTAMPTZ NOT NULL,
    before        JSONB,
    after         JSONB
);

CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, occurred_at);

-- Enforce append-only in the database too, not just by convention.
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER audit_events_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
