-- Current master data for orderable items. Copied into order_lines at Mark as
-- Ordered. Price and service period may be missing while an item is being set
-- up; Mark as Ordered refuses such an item rather than the catalogue refusing it.
CREATE TABLE catalogue_items (
    id                    UUID PRIMARY KEY,
    name                  TEXT NOT NULL CHECK (name <> ''),
    details               TEXT NOT NULL DEFAULT '',  -- manufacturer / model
    size_group            TEXT NOT NULL CHECK (size_group IN ('CLOTHING', 'SHOES', 'NONE')),
    unit_price_cents      BIGINT CHECK (unit_price_cents >= 0),
    currency              TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
    service_period_months INTEGER CHECK (service_period_months > 0),
    active                BOOLEAN NOT NULL DEFAULT TRUE,
    -- Lower sorts first in Add Item; ties sort by name.
    display_rank          INTEGER NOT NULL DEFAULT 1000,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL,
    deleted_at            TIMESTAMPTZ,
    created_by_user_id    UUID NOT NULL REFERENCES users (id),
    updated_by_user_id    UUID NOT NULL REFERENCES users (id),
    deleted_by_user_id    UUID REFERENCES users (id),
    CONSTRAINT catalogue_items_deletion_pair CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL))
);

CREATE UNIQUE INDEX catalogue_items_name_live_idx ON catalogue_items (lower(name)) WHERE deleted_at IS NULL;
