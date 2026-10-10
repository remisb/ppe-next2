-- The provider Add SIM Card fills in for a new card (Company Assets); empty
-- when there is none. Set from Add SIM Card by assets.manage.
ALTER TABLE app_settings ADD COLUMN default_sim_provider TEXT NOT NULL DEFAULT '';
