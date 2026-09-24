-- An order exists only from Mark as Ordered onwards: there is no draft row.
-- Everything a receipt shows is snapshotted here or in order_lines, so no
-- record is ever rebuilt from the live employees, catalogue or users tables.
CREATE SEQUENCE order_record_seq;

CREATE TABLE orders (
    id                  UUID PRIMARY KEY,
    record_seq          BIGINT NOT NULL UNIQUE DEFAULT nextval('order_record_seq'),
    employee_id         UUID NOT NULL REFERENCES employees (id),
    employee_first_name TEXT NOT NULL,
    employee_last_name  TEXT NOT NULL,
    employee_code       TEXT,
    status              TEXT NOT NULL CHECK (status IN ('ORDERED', 'GIVEN')),
    ordered_at          TIMESTAMPTZ NOT NULL,
    prepared_by_user_id UUID NOT NULL REFERENCES users (id),
    prepared_by_name    TEXT NOT NULL,
    given_at            TIMESTAMPTZ,
    given_by_user_id    UUID REFERENCES users (id),
    given_by_name       TEXT,
    confirmation_method TEXT CHECK (confirmation_method IN ('ELECTRONIC', 'PAPER')),
    updated_at          TIMESTAMPTZ NOT NULL,
    updated_by_user_id  UUID REFERENCES users (id),
    -- GIVEN fields are all set exactly when the order is GIVEN.
    CONSTRAINT orders_given_fields CHECK (
        (status = 'ORDERED' AND given_at IS NULL AND given_by_user_id IS NULL
            AND given_by_name IS NULL AND confirmation_method IS NULL)
        OR
        (status = 'GIVEN' AND given_at IS NOT NULL AND given_by_user_id IS NOT NULL
            AND given_by_name IS NOT NULL AND confirmation_method IS NOT NULL)
    )
);

CREATE INDEX orders_activity_idx ON orders ((coalesce(given_at, ordered_at)) DESC, id);
CREATE INDEX orders_employee_idx ON orders (employee_id);

-- Immutable snapshot lines. catalogue_item_id is a reference for reporting
-- only; every displayed value is copied.
CREATE TABLE order_lines (
    id                    UUID PRIMARY KEY,
    order_id              UUID NOT NULL REFERENCES orders (id),
    line_no               INTEGER NOT NULL CHECK (line_no >= 1),
    catalogue_item_id     UUID NOT NULL REFERENCES catalogue_items (id),
    item_name             TEXT NOT NULL,
    item_details          TEXT NOT NULL,
    size_group            TEXT NOT NULL CHECK (size_group IN ('CLOTHING', 'SHOES', 'NONE')),
    size                  TEXT,
    quantity              INTEGER NOT NULL CHECK (quantity >= 1),
    unit_price_cents      BIGINT NOT NULL CHECK (unit_price_cents >= 0),
    currency              TEXT NOT NULL CHECK (currency = 'EUR'),
    service_period_months INTEGER NOT NULL CHECK (service_period_months > 0),
    UNIQUE (order_id, line_no),
    UNIQUE (order_id, catalogue_item_id),
    CONSTRAINT order_lines_size_matches_group CHECK ((size_group = 'NONE') = (size IS NULL))
);

-- Snapshot lines never change once written.
CREATE FUNCTION order_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'order_lines are immutable';
END;
$$;

CREATE TRIGGER order_lines_no_update_delete
    BEFORE UPDATE OR DELETE ON order_lines
    FOR EACH ROW EXECUTE FUNCTION order_lines_immutable();
