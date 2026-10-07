DELETE FROM role_permissions WHERE permission = 'security.read';

UPDATE user_sessions SET end_reason = 'ended_elsewhere' WHERE end_reason = 'ended_by_administrator';
ALTER TABLE user_sessions DROP CONSTRAINT user_sessions_end_reason_known;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_end_reason_known CHECK (end_reason IN (
    'signed_out', 'ended_elsewhere', 'password_changed', 'password_reset',
    'deactivated', 'deleted', 'reused'
));

ALTER TABLE users DROP COLUMN last_sign_in_at;

DROP TABLE auth_events;
DROP FUNCTION auth_events_guard();
