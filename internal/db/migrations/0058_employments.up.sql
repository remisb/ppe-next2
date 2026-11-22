-- Employments (docs/specs/employee-service.md, "Employment"): an employee's
-- periods at a company, a child of the employee. One open period (no end) at a
-- time; periods never overlap (the service checks that under the employee's
-- row lock). A person's status derives from them: an open one is an employee,
-- only ended ones a former employee, none a candidate. Removing a period
-- entered by mistake is a soft delete.
CREATE TABLE employments (
    id                 UUID PRIMARY KEY,
    employee_id        UUID NOT NULL REFERENCES employees (id),
    company_id         UUID NOT NULL REFERENCES companies (id),
    -- Null when not recorded (the periods this migration opens).
    started_on         DATE,
    -- Null while open.
    ended_on           DATE,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    deleted_at         TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    updated_by_user_id UUID NOT NULL REFERENCES users (id),
    deleted_by_user_id UUID REFERENCES users (id),
    CONSTRAINT employments_deletion_pair CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL)),
    CONSTRAINT employments_dates_check CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)
);

CREATE UNIQUE INDEX employments_open_idx ON employments (employee_id) WHERE ended_on IS NULL AND deleted_at IS NULL;
CREATE INDEX employments_employee_idx ON employments (employee_id) WHERE deleted_at IS NULL;
CREATE INDEX employments_company_idx ON employments (company_id) WHERE deleted_at IS NULL;

-- Everyone kept today is employed by the default company (0057) from a date
-- not recorded; Personnel's Mark Employment Ended closes the period on its date.
INSERT INTO employments (id, employee_id, company_id, started_on, ended_on, created_at, updated_at, created_by_user_id, updated_by_user_id)
SELECT gen_random_uuid(), e.id, c.id, NULL, s.employment_ended_on, e.created_at, e.created_at, e.created_by_user_id, e.created_by_user_id
FROM employees e
CROSS JOIN companies c
LEFT JOIN personnel.subjects s ON s.employee_id = e.id
WHERE e.deleted_at IS NULL AND c.is_default AND c.deleted_at IS NULL;
