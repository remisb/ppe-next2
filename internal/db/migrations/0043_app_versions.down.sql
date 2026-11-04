ALTER TABLE error_events DROP COLUMN app_version;
UPDATE launcher_apps SET href = '/sim-scan/' WHERE slug = 'sim-scan' AND href = '/apps/sim-scan/';
DROP TABLE launcher_channel_choices;
DROP TABLE launcher_channels;
DROP TABLE launcher_versions;
