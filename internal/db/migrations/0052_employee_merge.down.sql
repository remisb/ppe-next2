DELETE FROM role_permissions WHERE permission = 'employees.merge';

CREATE OR REPLACE FUNCTION asset_assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'asset_assignments are never deleted';
    END IF;
    IF (NEW.id, NEW.asset_id, NEW.employee_id, NEW.given_date, NEW.given_by_user_id, NEW.created_at, NEW.comment,
            NEW.form, NEW.form_template_version, NEW.document_hash, NEW.paper_form_signed)
        IS DISTINCT FROM
        (OLD.id, OLD.asset_id, OLD.employee_id, OLD.given_date, OLD.given_by_user_id, OLD.created_at, OLD.comment,
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

DROP TABLE employee_distinct_pairs;
DROP INDEX employees_merged_into_idx;
ALTER TABLE employees DROP CONSTRAINT employees_merged_not_self,
    DROP CONSTRAINT employees_merged_deleted,
    DROP COLUMN merged_into_id;
