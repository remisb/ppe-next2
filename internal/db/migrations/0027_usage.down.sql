DELETE FROM role_permissions WHERE permission = 'usage.read';
ALTER TABLE order_confirmations DROP COLUMN first_opened_at;
DROP TABLE data_quality_samples;
DROP TABLE user_activity;
