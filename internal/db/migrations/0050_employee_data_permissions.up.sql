-- Employees' profiles and size defaults get permissions of their own
-- (docs/specs/employee-service.md, "Access"): employee_profiles.read and
-- .manage (code, notes, preferred language, photos, an identity document's
-- birth date, nationality and sex; adding and editing employees) and
-- employee_sizes.read and .manage (height, clothing and shoe size; Edit Sizes,
-- Save as Employee Default). Every signed-in user saw and changed them all, so
-- every role keeps them but the add-on roles Equipment Assignments, Testers and
-- Personnel Documents, as 0038 and 0049 did. Names stay everyone's. Same
-- grants as role.builtins.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES ('employee_profiles.read'), ('employee_profiles.manage'),
                   ('employee_sizes.read'), ('employee_sizes.manage')) AS p(permission)
WHERE r.key IS NULL OR r.key NOT IN ('equipment', 'testers', 'personnel')
ON CONFLICT DO NOTHING;
