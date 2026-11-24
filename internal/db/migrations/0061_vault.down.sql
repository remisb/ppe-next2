DELETE FROM role_permissions WHERE permission IN ('vault.read', 'vault.manage');
DROP SCHEMA vault CASCADE;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS unaccent;
