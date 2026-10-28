ALTER TABLE app_settings ADD COLUMN sim_providers TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE app_settings ADD COLUMN default_sim_plan TEXT NOT NULL DEFAULT ''
    CONSTRAINT app_settings_default_sim_plan_length CHECK (char_length(default_sim_plan) <= 100);

-- The one default plan is the default provider's, else the first one set.
UPDATE app_settings s SET
    sim_providers = ARRAY(SELECT name FROM sim_providers ORDER BY position),
    default_sim_plan = COALESCE(
        (SELECT default_plan FROM sim_providers WHERE name = s.default_sim_provider AND default_plan <> ''),
        (SELECT default_plan FROM sim_providers WHERE default_plan <> '' ORDER BY position LIMIT 1),
        '');
UPDATE app_settings SET default_sim_provider = '' WHERE default_sim_provider <> '' AND NOT default_sim_provider = ANY (sim_providers);

ALTER TABLE app_settings ADD CONSTRAINT app_settings_default_sim_provider_listed
    CHECK (default_sim_provider = '' OR default_sim_provider = ANY (sim_providers));

DROP TABLE sim_providers;
ALTER TABLE app_settings DROP COLUMN company_name;
