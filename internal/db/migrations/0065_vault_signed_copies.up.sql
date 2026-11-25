-- Signed copies move into the Document Vault (ADR 0008 decision 10, phase 5;
-- docs/specs/vault-service.md, "Signed copies"). Each assignment with signed
-- copies becomes one document of type asset.signed_form (source kind
-- asset_signed_form, the assignment's id: archiving the assignment form itself
-- in phase 6 is another source), linked to the asset and the employee (locked);
-- each copy becomes a version and its file with the copy's own id, object key,
-- name, type, size, SHA-256, time and uploader, its text pending and a job to
-- read it. No object is copied: the files stay under signed-copies/….
--
-- asset_signed_copies is frozen (grants.sql takes INSERT from ppe_app) and is
-- dropped a release later, with this function.

-- move_signed_copies moves every copy not in the vault yet and answers how
-- many it moved: this migration runs it once, `api -vault-backfill -commit`
-- again for a copy the previous release wrote while this one was deploying.
-- It runs as its caller (the owner here, ppe_app from the API).
CREATE FUNCTION vault.move_signed_copies() RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
    moved BIGINT;
BEGIN
    -- The assignments' documents, where they have none yet. Created as the
    -- first copy was; the title is the inventory number and the given date,
    -- as Company Assets names a new one (cmd/api/wire_vault.go).
    INSERT INTO vault.documents (id, type, type_words, title, document_date, origin, source_kind, source_id, requires,
        created_at, created_by_user_id, updated_at, updated_by_user_id)
    SELECT gen_random_uuid(), 'asset.signed_form',
        'signed form assignment pasirašyta forma perdavimo aktas подписанная форма акт передачи',
        a.inventory_no || ' · ' || o.given_date::text, o.given_date, 'uploaded', 'asset_signed_form', o.id,
        CASE WHEN a.kind = 'SIM' THEN ARRAY['sim_cards.read', 'vault.read'] ELSE ARRAY['equipment.read', 'vault.read'] END,
        first.uploaded_at, first.uploaded_by_user_id, first.uploaded_at, first.uploaded_by_user_id
    FROM asset_assignments o
    JOIN assets a ON a.id = o.asset_id
    CROSS JOIN LATERAL (
        SELECT c.uploaded_at, c.uploaded_by_user_id FROM asset_signed_copies c
        WHERE c.assignment_id = o.id ORDER BY c.uploaded_at, c.id LIMIT 1
    ) first
    WHERE NOT EXISTS (SELECT 1 FROM vault.documents d WHERE d.source_kind = 'asset_signed_form' AND d.source_id = o.id);

    -- Their links, the asset's and the employee's, each locked; labels as the
    -- vault's Subjects port names them (the upkeep refreshes them).
    INSERT INTO vault.links (document_id, subject_kind, subject_id, employee_id, label, requires, locked, created_at, created_by_user_id)
    SELECT d.id, 'asset', a.id, NULL,
        a.inventory_no || coalesce(' ' || nullif(a.name, ''), ' ' || nullif(a.phone_no, ''), ''),
        CASE WHEN a.kind = 'SIM' THEN ARRAY['sim_cards.read'] ELSE ARRAY['equipment.read'] END,
        true, d.created_at, d.created_by_user_id
    FROM vault.documents d
    JOIN asset_assignments o ON o.id = d.source_id
    JOIN assets a ON a.id = o.asset_id
    WHERE d.source_kind = 'asset_signed_form'
    ON CONFLICT DO NOTHING;
    INSERT INTO vault.links (document_id, subject_kind, subject_id, employee_id, label, requires, locked, created_at, created_by_user_id)
    SELECT d.id, 'employee', e.id, e.id, e.first_name || ' ' || e.last_name, '{}', true, d.created_at, d.created_by_user_id
    FROM vault.documents d
    JOIN asset_assignments o ON o.id = d.source_id
    JOIN employees e ON e.id = o.employee_id
    WHERE d.source_kind = 'asset_signed_form'
    ON CONFLICT DO NOTHING;

    -- The copies not moved yet, numbered after the document's newest version.
    CREATE TEMPORARY TABLE moving ON COMMIT DROP AS
    SELECT c.*, d.id AS document_id,
        coalesce((SELECT max(v.number) FROM vault.versions v WHERE v.document_id = d.id), 0)
            + row_number() OVER (PARTITION BY d.id ORDER BY c.uploaded_at, c.id) AS number
    FROM asset_signed_copies c
    JOIN vault.documents d ON d.source_kind = 'asset_signed_form' AND d.source_id = c.assignment_id
    WHERE NOT EXISTS (SELECT 1 FROM vault.versions v WHERE v.id = c.id);

    INSERT INTO vault.versions (id, document_id, number, origin, document_hash, created_at, created_by_user_id)
    SELECT id, document_id, number, CASE WHEN number = 1 THEN 'original' ELSE 'added' END, sha256, uploaded_at, uploaded_by_user_id
    FROM moving;
    INSERT INTO vault.files (id, version_id, role, object_key, file_name, content_type, size_bytes, sha256, created_at, created_by_user_id)
    SELECT id, id, 'main', object_key, file_name, content_type, size_bytes, sha256, uploaded_at, uploaded_by_user_id
    FROM moving;
    INSERT INTO vault.version_text (version_id, state) SELECT id, 'pending' FROM moving;
    -- Their reading, as insertVersion writes it (document.KindReadText).
    INSERT INTO outbox.jobs (id, kind, key, payload, state, run_after, created_at)
    SELECT gen_random_uuid(), 'vault.extract_text', id::text, jsonb_build_object('version', id), 'pending', now(), now()
    FROM moving
    ON CONFLICT (kind, key) WHERE state IN ('pending', 'running') DO NOTHING;

    UPDATE vault.documents d SET updated_at = m.uploaded_at, updated_by_user_id = m.uploaded_by_user_id
    FROM (SELECT DISTINCT ON (document_id) document_id, uploaded_at, uploaded_by_user_id FROM moving
          ORDER BY document_id, uploaded_at DESC, id DESC) m
    WHERE d.id = m.document_id AND d.updated_at < m.uploaded_at;
    PERFORM vault.refresh_search(document_id) FROM (SELECT DISTINCT document_id FROM moving) m;

    SELECT count(*) INTO moved FROM moving;
    DROP TABLE moving;
    IF moved > 0 THEN
        PERFORM pg_notify('outbox', 'vault.extract_text');
    END IF;
    RETURN moved;
END;
$$;

SELECT vault.move_signed_copies();
