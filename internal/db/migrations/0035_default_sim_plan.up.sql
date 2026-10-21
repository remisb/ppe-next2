-- The plan Give SIM fills in for a card that has none of its own (Company
-- Assets); empty when there is none. Set on Settings beside the default
-- provider, within an asset's own limit (100 characters).
ALTER TABLE app_settings ADD COLUMN default_sim_plan TEXT NOT NULL DEFAULT ''
    CONSTRAINT app_settings_default_sim_plan_length CHECK (char_length(default_sim_plan) <= 100);
