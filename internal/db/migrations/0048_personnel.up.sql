-- Personnel files (ADR 0007, docs/specs/personnel-service.md): a person's
-- identity documents, read by docs-import, sealed with the person's own data
-- key. Schema personnel is the context's (ADR 0001); its tables reach outside
-- it only to the shared kernel (employees) and the actors (users).
--
-- What is sealed (internal/sealbox, AES-256-GCM) is sealed by the API under
-- keys the database never holds: a dump or a backup carries only ciphertext.
-- The plain columns are only what "valid until" and retention need.
CREATE SCHEMA personnel;

-- The person as Personnel files sees them: one row per employee who has, or
-- had, a document. One personal code is one person (personal_index).
CREATE TABLE personnel.subjects (
    employee_id          UUID PRIMARY KEY REFERENCES employees (id),
    -- HMAC-SHA256 of the personal code under API_PERSONNEL_INDEX_KEY.
    personal_index       BYTEA UNIQUE CHECK (octet_length(personal_index) = 32),
    -- Retention runs from it (Mark Employment Ended); null while employed.
    employment_ended_on  DATE,
    -- A Legal Hold: the shredding job leaves the person alone until the date.
    hold_until           DATE,
    hold_reason          TEXT CHECK (length(hold_reason) <= 500),
    created_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL,
    updated_by_user_id   UUID NOT NULL REFERENCES users (id),
    CHECK ((hold_until IS NULL) = (hold_reason IS NULL))
);

-- The person's data key, sealed by the master keyring API_PERSONNEL_KEY and
-- bound to the employee. Deleting the row is the shredding: nothing of theirs
-- opens again.
CREATE TABLE personnel.subject_keys (
    employee_id  UUID PRIMARY KEY REFERENCES personnel.subjects (employee_id),
    sealed_key   BYTEA NOT NULL CHECK (octet_length(sealed_key) BETWEEN 29 AND 100),
    key_id       SMALLINT NOT NULL CHECK (key_id >= 1),
    created_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE personnel.identity_documents (
    id                  UUID PRIMARY KEY,
    employee_id         UUID NOT NULL REFERENCES personnel.subjects (employee_id),
    kind                TEXT NOT NULL CHECK (kind IN ('passport', 'id_card', 'residence_permit')),
    issuing_state       TEXT NOT NULL CHECK (issuing_state ~ '^[A-Z]{1,3}$'),
    issued_on           DATE,
    expires_on          DATE NOT NULL,
    -- Add to Employee Record, chosen at the scan (ADR 0007 decision 4).
    on_employee_record  BOOLEAN NOT NULL DEFAULT false,
    -- The number, personal code, MRZ, names, birth date, nationality, sex,
    -- place of birth and authority, sealed with the subject's data key.
    sealed              BYTEA NOT NULL CHECK (octet_length(sealed) BETWEEN 29 AND 8000),
    -- HMAC-SHA256 of the number under API_PERSONNEL_INDEX_KEY.
    number_index        BYTEA NOT NULL CHECK (octet_length(number_index) = 32),
    superseded_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users (id),
    updated_at          TIMESTAMPTZ NOT NULL,
    updated_by_user_id  UUID NOT NULL REFERENCES users (id),
    deleted_at          TIMESTAMPTZ,
    deleted_by_user_id  UUID REFERENCES users (id),
    CHECK (issued_on IS NULL OR issued_on <= expires_on)
);
-- One live document per number and state: two saves of one document at the
-- same moment are refused here.
CREATE UNIQUE INDEX identity_documents_number_live_idx
    ON personnel.identity_documents (number_index, issuing_state) WHERE deleted_at IS NULL;
CREATE INDEX identity_documents_employee_idx
    ON personnel.identity_documents (employee_id, created_at) WHERE deleted_at IS NULL;

-- A document's images: a passport's data page, a card's front and back, and
-- the portrait cut from it. The object (files store) is the JPEG sealed with
-- the subject's data key; sha256 is of the plain JPEG, checked on opening.
CREATE TABLE personnel.document_copies (
    id                  UUID PRIMARY KEY,
    document_id         UUID NOT NULL REFERENCES personnel.identity_documents (id),
    side                TEXT NOT NULL CHECK (side IN ('page', 'front', 'back', 'portrait')),
    object_key          TEXT NOT NULL UNIQUE CHECK (object_key ~ '^personnel/'),
    sha256              BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
    bytes               INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
    created_at          TIMESTAMPTZ NOT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users (id),
    UNIQUE (document_id, side)
);

-- The employee record (People) holds these only from a document saved with
-- Add to Employee Record on, and only the fields the user took (FR-8).
ALTER TABLE employees
    ADD COLUMN birth_date  DATE,
    ADD COLUMN nationality TEXT CHECK (nationality ~ '^[A-Z]{1,3}$'),
    ADD COLUMN sex         TEXT CHECK (sex IN ('M', 'F', 'X'));

-- Personnel Documents, a built-in role (role.PersonnelID), the only one
-- holding the personnel permissions: no other role, Administrator included,
-- gets them (as Equipment Assignments). Same id, name and description as
-- role.builtinRoles.
ALTER TABLE roles DROP CONSTRAINT roles_key_known;
ALTER TABLE roles ADD CONSTRAINT roles_key_known
    CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee', 'equipment', 'testers', 'personnel'));
INSERT INTO roles (id, key, name, description, created_at, updated_at) VALUES
    ('a0e1d000-0000-4000-8000-000000000006', 'personnel', 'Personnel Documents',
     'Scans, saves and shows identity documents.', now(), now());
INSERT INTO role_permissions (role_id, permission) VALUES
    ('a0e1d000-0000-4000-8000-000000000006', 'personnel.documents.read'),
    ('a0e1d000-0000-4000-8000-000000000006', 'personnel.documents.manage');
