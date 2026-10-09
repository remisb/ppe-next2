-- Company Assets (docs/specs/asset-service.md, ADR 0004): SIM cards and
-- individual equipment and furniture, each one physical item, and who holds
-- them. Location, office stock and days held are derived from the
-- assignments, never stored.
CREATE TABLE assets (
    id                     UUID PRIMARY KEY,
    kind                   TEXT NOT NULL CHECK (kind IN ('SIM', 'EQUIPMENT')),
    category               TEXT CHECK (category IN ('COMPUTER', 'PHONE', 'EXTERNAL_DRIVE', 'FURNITURE', 'OTHER')),
    inventory_no           TEXT NOT NULL,
    name                   TEXT,
    serial_no              TEXT,
    -- Kept as typed (leading zeros included); compared without spaces.
    sim_no                 TEXT,
    phone_no               TEXT,
    provider               TEXT,
    plan                   TEXT,
    non_return_value_cents BIGINT CHECK (non_return_value_cents >= 0),
    currency               TEXT NOT NULL CHECK (currency = 'EUR'),
    connection_status      TEXT CHECK (connection_status IN ('NOT_ACTIVATED', 'ACTIVE', 'BLOCKED')),
    received_date          DATE,
    comment                TEXT NOT NULL DEFAULT '',
    -- Reserved for write-off, which is not decided yet (spec, open decision 8).
    written_off_at         TIMESTAMPTZ,
    written_off_by_user_id UUID REFERENCES users (id),
    created_at             TIMESTAMPTZ NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL,
    deleted_at             TIMESTAMPTZ,
    created_by_user_id     UUID NOT NULL REFERENCES users (id),
    updated_by_user_id     UUID NOT NULL REFERENCES users (id),
    deleted_by_user_id     UUID REFERENCES users (id),
    -- A SIM card has numbers, a provider and a connection status; equipment
    -- has a name and a category, and none of the SIM's fields.
    CONSTRAINT assets_kind_fields CHECK (
        (kind = 'SIM' AND category IS NULL AND name IS NULL AND serial_no IS NULL
            AND sim_no IS NOT NULL AND provider IS NOT NULL AND connection_status IS NOT NULL
            AND received_date IS NOT NULL)
        OR
        (kind = 'EQUIPMENT' AND category IS NOT NULL AND name IS NOT NULL
            AND sim_no IS NULL AND phone_no IS NULL AND provider IS NULL AND plan IS NULL
            AND connection_status IS NULL AND received_date IS NULL)
    ),
    CONSTRAINT assets_written_off CHECK ((written_off_at IS NULL) = (written_off_by_user_id IS NULL)),
    CONSTRAINT assets_deleted CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL))
);

CREATE UNIQUE INDEX assets_inventory_no_idx ON assets (upper(inventory_no));
CREATE UNIQUE INDEX assets_sim_no_live_idx ON assets (upper(replace(sim_no, ' ', '')))
    WHERE deleted_at IS NULL AND sim_no IS NOT NULL;
CREATE INDEX assets_kind_idx ON assets (kind, upper(inventory_no)) WHERE deleted_at IS NULL;

-- Every inventory number ever used, so none is given to a second asset, even
-- after a correction or a soft delete (assets brief §16).
CREATE TABLE asset_numbers (
    number     TEXT NOT NULL,
    asset_id   UUID NOT NULL REFERENCES assets (id),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX asset_numbers_number_idx ON asset_numbers (upper(number));

-- The last number suggested or used per prefix: SIM, PC, PH, DRV, FUR, AST.
CREATE TABLE asset_number_counters (
    prefix TEXT PRIMARY KEY CHECK (prefix IN ('SIM', 'PC', 'PH', 'DRV', 'FUR', 'AST')),
    last   BIGINT NOT NULL CHECK (last >= 0)
);

-- One giving of an asset to one employee. Never deleted or rewritten: only
-- the Not Returned mark and the return are set later, each once.
CREATE TABLE asset_assignments (
    id                      UUID PRIMARY KEY,
    asset_id                UUID NOT NULL REFERENCES assets (id),
    employee_id             UUID NOT NULL REFERENCES employees (id),
    given_date              DATE NOT NULL,
    given_by_user_id        UUID NOT NULL REFERENCES users (id),
    created_at              TIMESTAMPTZ NOT NULL,
    comment                 TEXT NOT NULL DEFAULT '',
    -- The assignment form's data as printed, its template and its hash.
    form                    JSONB,
    form_template_version   TEXT,
    document_hash           TEXT,
    paper_form_signed       BOOLEAN NOT NULL,
    not_returned_at         TIMESTAMPTZ,
    not_returned_by_user_id UUID REFERENCES users (id),
    not_returned_comment    TEXT,
    whereabouts             TEXT CHECK (whereabouts IN ('WITH_EMPLOYEE', 'UNKNOWN')),
    returned_date           DATE,
    returned_at             TIMESTAMPTZ,
    returned_by_user_id     UUID REFERENCES users (id),
    return_comment          TEXT,
    CONSTRAINT asset_assignments_form CHECK (
        (form IS NULL AND form_template_version IS NULL AND document_hash IS NULL)
        OR (form IS NOT NULL AND form_template_version IS NOT NULL AND document_hash IS NOT NULL AND paper_form_signed)
    ),
    CONSTRAINT asset_assignments_not_returned CHECK (
        (not_returned_at IS NULL AND not_returned_by_user_id IS NULL AND not_returned_comment IS NULL AND whereabouts IS NULL)
        OR (not_returned_at IS NOT NULL AND not_returned_by_user_id IS NOT NULL AND not_returned_comment IS NOT NULL
            AND whereabouts IS NOT NULL)
    ),
    CONSTRAINT asset_assignments_returned CHECK (
        (returned_date IS NULL AND returned_at IS NULL AND returned_by_user_id IS NULL AND return_comment IS NULL)
        OR (returned_date IS NOT NULL AND returned_at IS NOT NULL AND returned_by_user_id IS NOT NULL
            AND return_comment IS NOT NULL AND returned_date >= given_date)
    )
);

-- At most one open assignment per asset: two users giving the same card at
-- once cannot both succeed.
CREATE UNIQUE INDEX asset_assignments_open_idx ON asset_assignments (asset_id) WHERE returned_date IS NULL;
CREATE INDEX asset_assignments_asset_idx ON asset_assignments (asset_id, given_date DESC);
CREATE INDEX asset_assignments_employee_idx ON asset_assignments (employee_id);

CREATE FUNCTION asset_assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'asset_assignments are never deleted';
    END IF;
    IF (NEW.id, NEW.asset_id, NEW.employee_id, NEW.given_date, NEW.given_by_user_id, NEW.created_at, NEW.comment,
            NEW.form, NEW.form_template_version, NEW.document_hash, NEW.paper_form_signed)
        IS DISTINCT FROM
        (OLD.id, OLD.asset_id, OLD.employee_id, OLD.given_date, OLD.given_by_user_id, OLD.created_at, OLD.comment,
            OLD.form, OLD.form_template_version, OLD.document_hash, OLD.paper_form_signed) THEN
        RAISE EXCEPTION 'an assignment''s giving is never changed';
    END IF;
    IF OLD.not_returned_at IS NOT NULL AND
        (NEW.not_returned_at, NEW.not_returned_by_user_id, NEW.not_returned_comment, NEW.whereabouts)
        IS DISTINCT FROM
        (OLD.not_returned_at, OLD.not_returned_by_user_id, OLD.not_returned_comment, OLD.whereabouts) THEN
        RAISE EXCEPTION 'an assignment''s Not Returned mark is set once';
    END IF;
    IF OLD.returned_date IS NOT NULL AND
        (NEW.returned_date, NEW.returned_at, NEW.returned_by_user_id, NEW.return_comment, NEW.not_returned_at)
        IS DISTINCT FROM
        (OLD.returned_date, OLD.returned_at, OLD.returned_by_user_id, OLD.return_comment, OLD.not_returned_at) THEN
        RAISE EXCEPTION 'a returned assignment is closed';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER asset_assignments_guard
    BEFORE UPDATE OR DELETE ON asset_assignments
    FOR EACH ROW EXECUTE FUNCTION asset_assignments_guard();

-- Every write needs assets.manage: the built-in Administrator and Manager
-- (spec, open decision 5).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'assets.manage'),
       ('a0e1d000-0000-4000-8000-000000000002', 'assets.manage')
ON CONFLICT DO NOTHING;
