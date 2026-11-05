DELETE FROM role_permissions WHERE permission = 'ai_usage.read';
ALTER TABLE employee_photos
    DROP CONSTRAINT employee_photos_ai_not_badge,
    DROP CONSTRAINT employee_photos_ai_consent,
    DROP COLUMN consent,
    DROP COLUMN ai_generated;
DROP FUNCTION clear_ai_usage_employee(UUID);
DROP TABLE ai_usage;
DROP TABLE ai_settings;
