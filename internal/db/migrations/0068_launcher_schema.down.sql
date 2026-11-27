-- Back to the launcher_ tables in public with a column per language. A tile
-- named in a language other than English, Lithuanian or Russian, or in a
-- group or feedback language this site had no CHECK for, makes it refuse.

ALTER TABLE launcher.feedback
    DROP CONSTRAINT feedback_language_check,
    ADD CONSTRAINT feedback_language_check CHECK (language IN ('en', 'lt', 'ru'));

ALTER TABLE launcher.apps
    DROP CONSTRAINT apps_group_check,
    ADD CONSTRAINT apps_group_check CHECK (app_group IN ('workwear', 'assets', 'people', 'admin')),
    ADD COLUMN name_en TEXT,
    ADD COLUMN name_lt TEXT,
    ADD COLUMN name_ru TEXT;
UPDATE launcher.apps SET name_en = names ->> 'en', name_lt = names ->> 'lt', name_ru = names ->> 'ru';
ALTER TABLE launcher.apps
    ALTER COLUMN name_en SET NOT NULL,
    ALTER COLUMN name_lt SET NOT NULL,
    ALTER COLUMN name_ru SET NOT NULL,
    ADD CONSTRAINT apps_name_en_check CHECK (char_length(name_en) BETWEEN 1 AND 60),
    ADD CONSTRAINT apps_name_lt_check CHECK (char_length(name_lt) BETWEEN 1 AND 60),
    ADD CONSTRAINT apps_name_ru_check CHECK (char_length(name_ru) BETWEEN 1 AND 60),
    DROP CONSTRAINT apps_names_check,
    DROP COLUMN names;

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT t.relname AS tbl, k.conname AS name
        FROM pg_constraint k
        JOIN pg_class t ON t.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'launcher'
    LOOP
        EXECUTE format('ALTER TABLE launcher.%I RENAME CONSTRAINT %I TO %I', c.tbl, c.name, 'launcher_' || c.name);
    END LOOP;
    FOR c IN
        SELECT i.relname AS name
        FROM pg_class i
        JOIN pg_namespace n ON n.oid = i.relnamespace
        WHERE n.nspname = 'launcher' AND i.relkind = 'i' AND i.relname NOT LIKE 'launcher\_%'
    LOOP
        EXECUTE format('ALTER INDEX launcher.%I RENAME TO %I', c.name, 'launcher_' || c.name);
    END LOOP;
END;
$$;

ALTER TABLE launcher.channel_choices RENAME TO launcher_channel_choices;
ALTER TABLE launcher.launcher_channel_choices SET SCHEMA public;
ALTER TABLE launcher.channels RENAME TO launcher_channels;
ALTER TABLE launcher.launcher_channels SET SCHEMA public;
ALTER TABLE launcher.versions RENAME TO launcher_versions;
ALTER TABLE launcher.launcher_versions SET SCHEMA public;
ALTER TABLE launcher.feedback RENAME TO launcher_feedback;
ALTER TABLE launcher.launcher_feedback SET SCHEMA public;
ALTER TABLE launcher.pins RENAME TO launcher_pins;
ALTER TABLE launcher.launcher_pins SET SCHEMA public;
ALTER TABLE launcher.apps RENAME TO launcher_apps;
ALTER TABLE launcher.launcher_apps SET SCHEMA public;

DROP SCHEMA launcher;
