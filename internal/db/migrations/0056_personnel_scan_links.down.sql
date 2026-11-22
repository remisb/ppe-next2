DROP INDEX IF EXISTS personnel.scans_document_idx;
ALTER TABLE personnel.scans
    DROP CONSTRAINT IF EXISTS scans_saved_check,
    DROP COLUMN IF EXISTS employee_id,
    DROP COLUMN IF EXISTS document_id,
    DROP COLUMN IF EXISTS state;
