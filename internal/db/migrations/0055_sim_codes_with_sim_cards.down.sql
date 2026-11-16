-- Back to 0041: Show PIN and PUK the Administrator's alone (role.AdminID).
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'sim_codes.read' FROM roles WHERE id = 'a0e1d000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;
