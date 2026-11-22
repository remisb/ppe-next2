DELETE FROM role_permissions WHERE permission = 'companies.manage';
ALTER TABLE app_settings ADD COLUMN company_name TEXT NOT NULL DEFAULT ''
    CONSTRAINT app_settings_company_name_length CHECK (char_length(company_name) <= 200);
UPDATE app_settings SET company_name = left(c.name, 200)
FROM companies c WHERE c.is_default AND c.deleted_at IS NULL AND c.name <> 'Company';
DROP TABLE companies;
