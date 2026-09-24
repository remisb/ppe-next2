-- People workwear is ordered for. Sizes are reusable defaults for future
-- orders; orders snapshot what they used, so editing these never alters history.
CREATE TABLE employees (
    id                 UUID PRIMARY KEY,
    first_name         TEXT NOT NULL CHECK (first_name <> ''),
    last_name          TEXT NOT NULL CHECK (last_name <> ''),
    code               TEXT CHECK (code <> ''),
    height_cm          INTEGER CHECK (height_cm BETWEEN 100 AND 250),
    -- Vocabulary mirrors internal/domain/size; keep the two in step.
    clothing_size      TEXT CHECK (clothing_size IN ('S', 'M', 'L', 'XL', '2XL', '3XL')),
    shoe_size          TEXT CHECK (shoe_size IN ('39', '40', '41', '42', '43', '44', '45', '46')),
    notes              TEXT NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    deleted_at         TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    updated_by_user_id UUID NOT NULL REFERENCES users (id),
    deleted_by_user_id UUID REFERENCES users (id),
    CONSTRAINT employees_deletion_pair CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL))
);

CREATE UNIQUE INDEX employees_code_live_idx ON employees (lower(code)) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX employees_name_live_idx ON employees (lower(last_name), lower(first_name)) WHERE deleted_at IS NULL;
