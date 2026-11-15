-- Suppliers (docs/specs/supplier-service.md): the companies catalogue items are
-- bought from, managed on Administration's Suppliers (suppliers.manage). Each
-- has an internal code, unique among live suppliers, and the details an
-- organisation is known by. Deletes are soft; an item whose supplier is
-- deleted reads as having none (the catalogue's reads join live suppliers only).
CREATE TABLE suppliers (
    id                 UUID PRIMARY KEY,
    code               TEXT NOT NULL CONSTRAINT suppliers_code_check CHECK (code <> '' AND char_length(code) <= 32),
    name               TEXT NOT NULL CONSTRAINT suppliers_name_check CHECK (name <> '' AND char_length(name) <= 200),
    -- The company's registration number (įmonės kodas) and VAT code.
    company_code       TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_company_code_length CHECK (char_length(company_code) <= 50),
    vat_code           TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_vat_code_length CHECK (char_length(vat_code) <= 50),
    address            TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_address_length CHECK (char_length(address) <= 300),
    city               TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_city_length CHECK (char_length(city) <= 100),
    postal_code        TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_postal_code_length CHECK (char_length(postal_code) <= 20),
    -- ISO 3166-1 alpha-2, or empty.
    country            TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_country_check CHECK (country = '' OR country ~ '^[A-Z]{2}$'),
    contact_person     TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_contact_person_length CHECK (char_length(contact_person) <= 200),
    email              TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_email_length CHECK (char_length(email) <= 254),
    phone              TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_phone_length CHECK (char_length(phone) <= 50),
    website            TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_website_length CHECK (char_length(website) <= 300),
    bank_account       TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_bank_account_length CHECK (char_length(bank_account) <= 50),
    notes              TEXT NOT NULL DEFAULT '' CONSTRAINT suppliers_notes_length CHECK (char_length(notes) <= 2000),
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    deleted_at         TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    updated_by_user_id UUID NOT NULL REFERENCES users (id),
    deleted_by_user_id UUID REFERENCES users (id),
    CONSTRAINT suppliers_deletion_pair CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL))
);

CREATE UNIQUE INDEX suppliers_code_live_idx ON suppliers (lower(code)) WHERE deleted_at IS NULL;

-- An item's supplier, optional. Never set to a deleted supplier by the app;
-- one deleted later stays here and reads as none.
ALTER TABLE catalogue_items ADD COLUMN supplier_id UUID CONSTRAINT catalogue_items_supplier_fkey REFERENCES suppliers (id);
CREATE INDEX catalogue_items_supplier_idx ON catalogue_items (supplier_id) WHERE supplier_id IS NOT NULL;

-- Manage Suppliers, the Administrator's (role.AdminID).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'suppliers.manage') ON CONFLICT DO NOTHING;
