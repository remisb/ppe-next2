-- Rows written since with another app's slug stay; the old lists apply to new rows only.
ALTER TABLE user_activity DROP CONSTRAINT user_activity_app_check;
ALTER TABLE user_activity ADD CONSTRAINT user_activity_app_check CHECK (app IN ('workwear', 'admin', 'api')) NOT VALID;
ALTER TABLE error_events DROP CONSTRAINT error_events_source_check;
ALTER TABLE error_events ADD CONSTRAINT error_events_source_check
    CHECK (source IN ('workwear', 'admin', 'api', 'public_link', 'system')) NOT VALID;
ALTER TABLE auth_events DROP CONSTRAINT auth_events_source_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_source_check
    CHECK (source IN ('workwear', 'admin', 'api', 'public_link', 'system')) NOT VALID;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_source_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_source_check
    CHECK (source IN ('workwear', 'admin', 'api', 'public_link', 'system')) NOT VALID;

DELETE FROM user_roles WHERE role_id = 'a0e1d000-0000-4000-8000-000000000005';
DELETE FROM role_permissions WHERE role_id = 'a0e1d000-0000-4000-8000-000000000005' OR permission IN ('apps.manage', 'apps.preview');
DELETE FROM roles WHERE id = 'a0e1d000-0000-4000-8000-000000000005';
ALTER TABLE roles DROP CONSTRAINT roles_key_known;
ALTER TABLE roles ADD CONSTRAINT roles_key_known CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee', 'equipment'));

DROP TABLE launcher_feedback;
DROP TABLE launcher_pins;
DROP TABLE launcher_apps;
