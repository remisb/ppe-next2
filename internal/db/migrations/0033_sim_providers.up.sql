-- The SIM card providers administrators list on Settings (Company Assets): Add
-- SIM offers them, with default_sim_provider, one of them or '', chosen first.
ALTER TABLE app_settings ADD COLUMN sim_providers TEXT[] NOT NULL DEFAULT '{}';

-- The list starts from the default provider and the providers of the SIM cards
-- registered, one spelling each (the default's where they differ in case).
UPDATE app_settings SET sim_providers = ARRAY(
    SELECT name FROM (
        SELECT DISTINCT ON (lower(name)) name FROM (
            SELECT default_sim_provider AS name, 0 AS rank FROM app_settings WHERE default_sim_provider <> ''
            UNION ALL
            SELECT btrim(provider), 1 FROM assets
            WHERE kind = 'SIM' AND deleted_at IS NULL AND provider IS NOT NULL AND btrim(provider) <> ''
        ) candidates
        ORDER BY lower(name), rank, name
    ) providers
    ORDER BY lower(name)
);

ALTER TABLE app_settings ADD CONSTRAINT app_settings_default_sim_provider_listed
    CHECK (default_sim_provider = '' OR default_sim_provider = ANY (sim_providers));
