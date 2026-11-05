DELETE FROM role_permissions
WHERE permission IN ('employee_profiles.read', 'employee_profiles.manage', 'employee_sizes.read', 'employee_sizes.manage');
