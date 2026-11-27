-- App Launcher in a schema of its own (ADR 0009): the registry, to become a
-- module other applications embed, owns schema launcher and reads nothing
-- outside it. The six tables move with their rows, grants and foreign keys
-- (to users included: this site keeps them), and lose the launcher_ prefix,
-- as do their constraints and indexes. A tile's names become one map per
-- language, and the groups and feedback's languages the host's (checked by
-- the API's launcher.Config), so the schema names no site's.

CREATE SCHEMA launcher;

ALTER TABLE launcher_apps SET SCHEMA launcher;
ALTER TABLE launcher.launcher_apps RENAME TO apps;
ALTER TABLE launcher_pins SET SCHEMA launcher;
ALTER TABLE launcher.launcher_pins RENAME TO pins;
ALTER TABLE launcher_feedback SET SCHEMA launcher;
ALTER TABLE launcher.launcher_feedback RENAME TO feedback;
ALTER TABLE launcher_versions SET SCHEMA launcher;
ALTER TABLE launcher.launcher_versions RENAME TO versions;
ALTER TABLE launcher_channels SET SCHEMA launcher;
ALTER TABLE launcher.launcher_channels RENAME TO channels;
ALTER TABLE launcher_channel_choices SET SCHEMA launcher;
ALTER TABLE launcher.launcher_channel_choices RENAME TO channel_choices;

-- Constraints (and the indexes behind keys) first, then the other indexes.
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT t.relname AS tbl, k.conname AS name
        FROM pg_constraint k
        JOIN pg_class t ON t.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'launcher' AND k.conname LIKE 'launcher\_%'
    LOOP
        EXECUTE format('ALTER TABLE launcher.%I RENAME CONSTRAINT %I TO %I', c.tbl, c.name, substr(c.name, 10));
    END LOOP;
    FOR c IN
        SELECT i.relname AS name
        FROM pg_class i
        JOIN pg_namespace n ON n.oid = i.relnamespace
        WHERE n.nspname = 'launcher' AND i.relkind = 'i' AND i.relname LIKE 'launcher\_%'
    LOOP
        EXECUTE format('ALTER INDEX launcher.%I RENAME TO %I', c.name, substr(c.name, 10));
    END LOOP;
END;
$$;

ALTER TABLE launcher.apps ADD COLUMN names JSONB;
UPDATE launcher.apps SET names = jsonb_build_object('en', name_en, 'lt', name_lt, 'ru', name_ru);
ALTER TABLE launcher.apps
    ALTER COLUMN names SET NOT NULL,
    ADD CONSTRAINT apps_names_check CHECK (jsonb_typeof(names) = 'object' AND names <> '{}'),
    DROP COLUMN name_en,
    DROP COLUMN name_lt,
    DROP COLUMN name_ru,
    DROP CONSTRAINT apps_group_check,
    ADD CONSTRAINT apps_group_check CHECK (app_group ~ '^[a-z][a-z0-9-]{0,30}$');

ALTER TABLE launcher.feedback
    DROP CONSTRAINT feedback_language_check,
    ADD CONSTRAINT feedback_language_check CHECK (language ~ '^[a-z]{2,3}$');
