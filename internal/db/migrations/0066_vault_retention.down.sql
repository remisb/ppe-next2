-- Back to shredding sealed documents alone. A tombstone of a document that
-- was not sealed takes a title again, as the earlier CHECK needs one.
CREATE OR REPLACE FUNCTION vault.shred_document(doc UUID, at TIMESTAMPTZ, day DATE) RETURNS SETOF TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, public, pg_temp AS $$
DECLARE
    keys TEXT[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vault.documents d WHERE d.id = doc AND d.sealed AND d.shredded_at IS NULL
            AND (d.hold_until IS NULL OR d.hold_until < day)) THEN
        RAISE EXCEPTION 'document % is not sealed, is shredded already, or is held', doc;
    END IF;
    SELECT array_agg(f.object_key) INTO keys
        FROM vault.files f JOIN vault.versions v ON v.id = f.version_id WHERE v.document_id = doc;
    PERFORM set_config('ppe.vault_shred', 'on', true);
    DELETE FROM vault.document_keys WHERE document_id = doc;
    DELETE FROM vault.version_text t USING vault.versions v WHERE t.version_id = v.id AND v.document_id = doc;
    DELETE FROM vault.files f USING vault.versions v WHERE f.version_id = v.id AND v.document_id = doc;
    DELETE FROM vault.versions WHERE document_id = doc;
    DELETE FROM vault.links WHERE document_id = doc;
    UPDATE vault.documents SET title_sealed = NULL, search = ''::tsvector, shredded_at = at WHERE id = doc;
    PERFORM set_config('ppe.vault_shred', 'off', true);
    RETURN QUERY SELECT unnest(coalesce(keys, '{}'::TEXT[]));
END;
$$;

DROP INDEX vault.vault_documents_retain_idx;
UPDATE vault.documents SET title = 'Shredded' WHERE NOT sealed AND title = '';
ALTER TABLE vault.documents
    DROP CONSTRAINT vault_documents_title_check,
    ADD CONSTRAINT vault_documents_title_check CHECK (
        char_length(title) <= 200 AND (sealed OR char_length(title) >= 1));
