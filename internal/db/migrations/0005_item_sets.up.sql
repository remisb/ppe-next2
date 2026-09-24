-- Presets of catalogue items. A set stores only references, default quantities
-- and order: never sizes, prices or service periods, which are resolved fresh
-- each time the set is applied.
CREATE TABLE item_sets (
    id                 UUID PRIMARY KEY,
    name               TEXT NOT NULL CHECK (name <> ''),
    description        TEXT NOT NULL DEFAULT '',
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    deleted_at         TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    updated_by_user_id UUID NOT NULL REFERENCES users (id),
    deleted_by_user_id UUID REFERENCES users (id),
    CONSTRAINT item_sets_deletion_pair CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL))
);

CREATE UNIQUE INDEX item_sets_name_live_idx ON item_sets (lower(name)) WHERE deleted_at IS NULL;

-- Lines are owned by their set and replaced wholesale on update.
CREATE TABLE item_set_lines (
    item_set_id       UUID NOT NULL REFERENCES item_sets (id) ON DELETE CASCADE,
    catalogue_item_id UUID NOT NULL REFERENCES catalogue_items (id),
    default_quantity  INTEGER NOT NULL CHECK (default_quantity >= 1),
    display_order     INTEGER NOT NULL CHECK (display_order >= 0),
    PRIMARY KEY (item_set_id, catalogue_item_id),
    UNIQUE (item_set_id, display_order)
);
