-- App Launcher (ADR 0006; the handbook's critique P1): named variants are
-- removed, so an app's channels are Stable, Beta and Preview, Beta and Preview
-- for testers. Variants were never used in production; with them go their
-- labels, the channels' own audiences, and the screens builds listed so that
-- no variant took a screen's address (migration 0046). The audit trail keeps
-- every earlier app.channel_changed.
DELETE FROM launcher_channel_choices WHERE channel NOT IN ('beta', 'preview');
DELETE FROM launcher_channels WHERE name NOT IN ('stable', 'beta', 'preview');
ALTER TABLE launcher_channels
    DROP COLUMN label_en,
    DROP COLUMN label_lt,
    DROP COLUMN label_ru,
    DROP COLUMN any_of,
    DROP CONSTRAINT launcher_channels_name_check,
    ADD CONSTRAINT launcher_channels_name_check CHECK (name IN ('stable', 'beta', 'preview'));
ALTER TABLE launcher_channel_choices
    ADD CONSTRAINT launcher_channel_choices_channel_check CHECK (channel IN ('beta', 'preview'));
ALTER TABLE launcher_versions DROP COLUMN screens;
