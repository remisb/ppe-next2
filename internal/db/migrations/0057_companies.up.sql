-- Companies (docs/specs/company-service.md): the organisation's own companies
-- that employees are employed by (migration 0058's employments), managed on
-- Administration's Companies (companies.manage). At most one live company is
-- the default: Add New Employee chooses it first and mail templates name it
-- ({{company.name}}, which was Settings' Company name until now).
CREATE TABLE companies (
    id                 UUID PRIMARY KEY,
    -- The internal code, optional; unique among live companies when set.
    code               TEXT NOT NULL DEFAULT '' CONSTRAINT companies_code_length CHECK (char_length(code) <= 32),
    name               TEXT NOT NULL CONSTRAINT companies_name_check CHECK (name <> '' AND char_length(name) <= 200),
    -- The registration number (įmonės kodas) and VAT code.
    company_code       TEXT NOT NULL DEFAULT '' CONSTRAINT companies_company_code_length CHECK (char_length(company_code) <= 50),
    vat_code           TEXT NOT NULL DEFAULT '' CONSTRAINT companies_vat_code_length CHECK (char_length(vat_code) <= 50),
    address            TEXT NOT NULL DEFAULT '' CONSTRAINT companies_address_length CHECK (char_length(address) <= 300),
    city               TEXT NOT NULL DEFAULT '' CONSTRAINT companies_city_length CHECK (char_length(city) <= 100),
    postal_code        TEXT NOT NULL DEFAULT '' CONSTRAINT companies_postal_code_length CHECK (char_length(postal_code) <= 20),
    -- ISO 3166-1 alpha-2, or empty.
    country            TEXT NOT NULL DEFAULT '' CONSTRAINT companies_country_check CHECK (country = '' OR country ~ '^[A-Z]{2}$'),
    notes              TEXT NOT NULL DEFAULT '' CONSTRAINT companies_notes_length CHECK (char_length(notes) <= 2000),
    is_default         BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    deleted_at         TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    updated_by_user_id UUID NOT NULL REFERENCES users (id),
    deleted_by_user_id UUID REFERENCES users (id),
    CONSTRAINT companies_deletion_pair CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL)),
    -- The default is never deleted (make another the default first).
    CONSTRAINT companies_default_live CHECK (NOT (is_default AND deleted_at IS NOT NULL))
);

CREATE UNIQUE INDEX companies_code_live_idx ON companies (lower(code)) WHERE deleted_at IS NULL AND code <> '';
CREATE UNIQUE INDEX companies_default_idx ON companies (is_default) WHERE is_default AND deleted_at IS NULL;

-- Settings' Company name becomes the first company, the default, when it was
-- set or anyone is an employee already (they are employed by it: 0058). It is
-- attributed to whoever set the name, else to whoever added the first employee.
INSERT INTO companies (id, name, is_default, created_at, updated_at, created_by_user_id, updated_by_user_id)
SELECT gen_random_uuid(), coalesce(nullif((SELECT company_name FROM app_settings), ''), 'Company'), true, now(), now(), actor, actor
FROM (SELECT coalesce(
        (SELECT updated_by_user_id FROM app_settings WHERE company_name <> ''),
        (SELECT created_by_user_id FROM employees ORDER BY created_at, id LIMIT 1)) AS actor) a
WHERE a.actor IS NOT NULL;

ALTER TABLE app_settings DROP COLUMN company_name;

-- Manage Companies, the Administrator's (role.AdminID).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'companies.manage') ON CONFLICT DO NOTHING;
