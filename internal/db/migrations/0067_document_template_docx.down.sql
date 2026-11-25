-- Back to templates of blocks alone. A generated version that keeps a DOCX
-- (append-only) makes the files' CHECK refuse: such a database cannot go back.
DROP TABLE vault.renders;
ALTER TABLE vault.files
    DROP CONSTRAINT files_content_type_check,
    ADD CONSTRAINT files_content_type_check CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png'));
DELETE FROM vault.template_versions WHERE kind = 'docx' AND state = 'draft';
ALTER TABLE vault.template_versions
    DROP CONSTRAINT vault_template_versions_docx,
    DROP COLUMN docx_size, DROP COLUMN docx_name, DROP COLUMN docx_key, DROP COLUMN kind;
