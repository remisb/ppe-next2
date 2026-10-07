DELETE FROM role_permissions WHERE permission = 'audit.read';

DROP INDEX audit_events_event_idx;
DROP INDEX audit_events_actor_idx;
DROP INDEX audit_events_time_idx;

-- The trigger forbids UPDATE and DELETE, not dropping columns: the trail
-- loses only the context recorded since 0023.
ALTER TABLE audit_events DROP COLUMN source, DROP COLUMN session_id, DROP COLUMN request_id;
