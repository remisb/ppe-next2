-- A SIM card's PIN and PUK (Scan SIMs, ADR 0005), sealed by the API with
-- AES-256-GCM under API_SIM_CODES_KEY (internal/sealbox), which the database
-- never holds: a dump or a backup carries only ciphertext. The two are sealed
-- together, bound to the asset's id, so neither moves to another card. One
-- row per SIM card that has them; asset.Service writes rows for SIM cards only.
CREATE TABLE asset_sim_codes (
    asset_id           UUID PRIMARY KEY REFERENCES assets (id),
    sealed             BYTEA NOT NULL CONSTRAINT asset_sim_codes_sealed_check CHECK (octet_length(sealed) BETWEEN 29 AND 200),
    -- The key the row is sealed under, so a later key can be brought in beside it.
    key_id             SMALLINT NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    updated_by_user_id UUID NOT NULL REFERENCES users (id)
);

-- One card, one SIM No.: a 20-character ICCID ends in the filler F, which a
-- barcode or a typed number may leave out, so 8937…5135 and 8937…5135F are
-- the same card (asset.simKey).
DROP INDEX assets_sim_no_live_idx;
CREATE UNIQUE INDEX assets_sim_no_live_idx ON assets (regexp_replace(upper(replace(sim_no, ' ', '')), 'F$', ''))
    WHERE deleted_at IS NULL AND sim_no IS NOT NULL;

-- Show PIN and PUK, the Administrator's (role.AdminID). A database whose
-- roles are not installed yet gets it with them (role.EnsureBuiltins).
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'sim_codes.read' FROM roles WHERE id = 'a0e1d000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;
