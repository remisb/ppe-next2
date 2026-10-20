-- The Non-return Value Add SIM fills in for a new card (Company Assets), in
-- cents; NULL when there is none. Set on Settings beside the default provider,
-- within an asset's own limit (0 to a hundred million euros).
ALTER TABLE app_settings ADD COLUMN default_sim_non_return_value_cents BIGINT
    CONSTRAINT app_settings_default_sim_non_return_value_range
    CHECK (default_sim_non_return_value_cents BETWEEN 0 AND 10000000000);
