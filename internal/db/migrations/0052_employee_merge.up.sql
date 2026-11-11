-- Duplicate employees (docs/specs/employee-service.md, "Duplicates and
-- merging"): Merge Employees keeps one record and removes the other, moving
-- its orders, company assets and photos to the one kept.

-- The removed record points at the one kept, so its old links and its
-- Changes lead there.
ALTER TABLE employees ADD COLUMN merged_into_id UUID REFERENCES employees (id),
    ADD CONSTRAINT employees_merged_deleted CHECK (merged_into_id IS NULL OR deleted_at IS NOT NULL),
    ADD CONSTRAINT employees_merged_not_self CHECK (merged_into_id <> id);
CREATE INDEX employees_merged_into_idx ON employees (merged_into_id) WHERE merged_into_id IS NOT NULL;

-- Not the Same Person: two employees whose names are alike but who are two
-- people, so the Employees screen stops asking. employee_a < employee_b.
CREATE TABLE employee_distinct_pairs (
    employee_a        UUID NOT NULL REFERENCES employees (id),
    employee_b        UUID NOT NULL REFERENCES employees (id),
    marked_by_user_id UUID NOT NULL REFERENCES users (id),
    marked_at         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (employee_a, employee_b),
    CONSTRAINT employee_distinct_pairs_ordered CHECK (employee_a < employee_b)
);

-- An assignment's giving is never changed, except whose it is when two
-- records of one person are merged: the transaction says so with
-- SET LOCAL ppe.employee_merge = on. The signed form keeps the name it was
-- signed with. Otherwise as 0029.
CREATE OR REPLACE FUNCTION asset_assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'asset_assignments are never deleted';
    END IF;
    IF NEW.employee_id IS DISTINCT FROM OLD.employee_id
        AND coalesce(current_setting('ppe.employee_merge', true), '') <> 'on' THEN
        RAISE EXCEPTION 'an assignment''s giving is never changed';
    END IF;
    IF (NEW.id, NEW.asset_id, NEW.given_date, NEW.given_by_user_id, NEW.created_at, NEW.comment,
            NEW.form, NEW.form_template_version, NEW.document_hash, NEW.paper_form_signed)
        IS DISTINCT FROM
        (OLD.id, OLD.asset_id, OLD.given_date, OLD.given_by_user_id, OLD.created_at, OLD.comment,
            OLD.form, OLD.form_template_version, OLD.document_hash, OLD.paper_form_signed) THEN
        RAISE EXCEPTION 'an assignment''s giving is never changed';
    END IF;
    IF OLD.not_returned_at IS NOT NULL AND
        (NEW.not_returned_at, NEW.not_returned_by_user_id, NEW.not_returned_comment, NEW.whereabouts)
        IS DISTINCT FROM
        (OLD.not_returned_at, OLD.not_returned_by_user_id, OLD.not_returned_comment, OLD.whereabouts) THEN
        RAISE EXCEPTION 'an assignment''s Not Returned mark is set once';
    END IF;
    IF OLD.returned_date IS NOT NULL AND
        (NEW.returned_date, NEW.returned_at, NEW.returned_by_user_id, NEW.return_comment, NEW.not_returned_at)
        IS DISTINCT FROM
        (OLD.returned_date, OLD.returned_at, OLD.returned_by_user_id, OLD.return_comment, OLD.not_returned_at) THEN
        RAISE EXCEPTION 'a returned assignment is closed';
    END IF;
    RETURN NEW;
END;
$$;

-- Merge employees: the built-in Administrator and Manager, who delete
-- employees too. Same grants as role.builtins.
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'employees.merge'),
       ('a0e1d000-0000-4000-8000-000000000002', 'employees.merge')
ON CONFLICT DO NOTHING;
