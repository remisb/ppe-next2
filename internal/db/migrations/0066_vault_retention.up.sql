-- Retention for every type whose rule shreds (Lithuania's minimum retention
-- periods; docs/specs/vault-service.md, "Retention"), not only sealed ones:
-- the shredding now takes any document, and leaves the same tombstone (type,
-- number and dates; no title, versions, files, read text or links).

ALTER TABLE vault.documents
    DROP CONSTRAINT vault_documents_title_check,
    ADD CONSTRAINT vault_documents_title_check CHECK (
        char_length(title) <= 200 AND (sealed OR shredded_at IS NOT NULL OR char_length(title) >= 1));

CREATE INDEX vault_documents_retain_idx ON vault.documents (retain_until) WHERE shredded_at IS NULL;

-- shred_document makes a document unreadable for good: a sealed one's key
-- goes, and every document's versions, files, read text and links; its row
-- stays as a tombstone with its type, number and dates. It runs as the owner
-- (SECURITY DEFINER), so ppe_app needs no DELETE on versions and files, and
-- refuses a document already shredded or under a Legal Hold on day. It
-- returns the files' object keys, for the API to delete from the store.
CREATE OR REPLACE FUNCTION vault.shred_document(doc UUID, at TIMESTAMPTZ, day DATE) RETURNS SETOF TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, public, pg_temp AS $$
DECLARE
    keys TEXT[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vault.documents d WHERE d.id = doc AND d.shredded_at IS NULL
            AND (d.hold_until IS NULL OR d.hold_until < day)) THEN
        RAISE EXCEPTION 'document % is shredded already, or is held', doc;
    END IF;
    SELECT array_agg(f.object_key) INTO keys
        FROM vault.files f JOIN vault.versions v ON v.id = f.version_id WHERE v.document_id = doc;
    PERFORM set_config('ppe.vault_shred', 'on', true);
    DELETE FROM vault.document_keys WHERE document_id = doc;
    DELETE FROM vault.version_text t USING vault.versions v WHERE t.version_id = v.id AND v.document_id = doc;
    DELETE FROM vault.files f USING vault.versions v WHERE f.version_id = v.id AND v.document_id = doc;
    DELETE FROM vault.versions WHERE document_id = doc;
    DELETE FROM vault.links WHERE document_id = doc;
    UPDATE vault.documents SET title = '', title_sealed = NULL, search = ''::tsvector, shredded_at = at WHERE id = doc;
    PERFORM set_config('ppe.vault_shred', 'off', true);
    RETURN QUERY SELECT unnest(coalesce(keys, '{}'::TEXT[]));
END;
$$;
