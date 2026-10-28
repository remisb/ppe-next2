-- The company's name, which mail templates write ({{company.name}}); empty
-- when not set. Set on Settings by settings.manage.
ALTER TABLE app_settings ADD COLUMN company_name TEXT NOT NULL DEFAULT ''
    CONSTRAINT app_settings_company_name_length CHECK (char_length(company_name) <= 200);

-- The SIM providers become records: each with the e-mail address its
-- activation and blocking emails go to and the plan Add SIM and Give SIM fill
-- in, both empty when not set. They belong to the settings row, so emptying
-- app_settings (TRUNCATE users CASCADE) empties them too.
CREATE TABLE sim_providers (
    singleton    BOOLEAN NOT NULL DEFAULT TRUE REFERENCES app_settings (singleton) ON DELETE CASCADE,
    position     INT NOT NULL CONSTRAINT sim_providers_position_check CHECK (position >= 0),
    name         TEXT NOT NULL CONSTRAINT sim_providers_name_check CHECK (name <> '' AND char_length(name) <= 100),
    email        TEXT NOT NULL DEFAULT '' CONSTRAINT sim_providers_email_length CHECK (char_length(email) <= 254),
    default_plan TEXT NOT NULL DEFAULT '' CONSTRAINT sim_providers_default_plan_length CHECK (char_length(default_plan) <= 100),
    PRIMARY KEY (singleton, position)
);
CREATE UNIQUE INDEX sim_providers_name_key ON sim_providers (lower(name));

-- Each provider listed keeps its place and takes the one default plan there
-- was, so Give SIM fills in what it did.
INSERT INTO sim_providers (position, name, default_plan)
SELECT p.ord - 1, p.name, s.default_sim_plan
FROM app_settings s, unnest(s.sim_providers) WITH ORDINALITY AS p (name, ord);

-- The default provider stays a name; the settings service keeps it among the
-- providers (it was the array's CHECK).
ALTER TABLE app_settings DROP CONSTRAINT app_settings_default_sim_provider_listed;
ALTER TABLE app_settings DROP COLUMN sim_providers;
ALTER TABLE app_settings DROP COLUMN default_sim_plan;
