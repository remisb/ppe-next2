DELETE FROM role_permissions WHERE permission = 'document_templates.manage';
ALTER TABLE vault.versions DROP COLUMN data;
ALTER TABLE vault.documents DROP CONSTRAINT vault_documents_template_pair, DROP COLUMN template_version, DROP COLUMN template_id;
DROP TABLE vault.document_number_counters;
DROP TABLE vault.template_versions;
DROP FUNCTION vault.template_versions_guard();
DROP TABLE vault.templates;
