-- Export data (data.export, docs/specs/role-service.md): Export on every list
-- of both apps (WARE-43/44/45), which whoever saw a list had. The lists are
-- built in the browser, so no route needs it; the apps show Export by it. The
-- Audit log's export stays audit.export's. Every role keeps what it allowed:
-- all but the add-on roles Equipment Assignments, Testers and Personnel
-- Documents, as 0049 did for SIM cards. Same grants as role.builtins.
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'data.export' FROM roles
WHERE key IS NULL OR key NOT IN ('equipment', 'testers', 'personnel')
ON CONFLICT DO NOTHING;
