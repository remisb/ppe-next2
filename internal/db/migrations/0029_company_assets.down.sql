DELETE FROM role_permissions WHERE permission = 'assets.manage';
DROP TABLE asset_assignments;
DROP FUNCTION asset_assignments_guard();
DROP TABLE asset_number_counters;
DROP TABLE asset_numbers;
DROP TABLE assets;
