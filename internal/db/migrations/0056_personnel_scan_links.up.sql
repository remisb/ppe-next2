-- Scan Documents (docs-scan; ADR 0007 amendment of 2026-11-21, docs/specs/personnel-service.md
-- "Kept scans"): every scan is kept once its pages are taken, read or not, and the one saved
-- as a document points to it and its employee, so the app's Scans can show each one's state.
--
-- unread: no MRZ, or one that did not pass the API's re-reading; read: it passed; saved:
-- Save named the scan, which then has its document and employee. Saving is the only change a
-- row ever gets (ppe_app may update these three columns alone). Removing the document, or
-- shredding the file, erases the scan with it; the cascade is the safety net for the shredding,
-- which deletes it itself to delete its object too.
ALTER TABLE personnel.scans
    ADD COLUMN state TEXT NOT NULL DEFAULT 'read' CHECK (state IN ('unread', 'read', 'saved')),
    ADD COLUMN document_id UUID REFERENCES personnel.identity_documents (id) ON DELETE CASCADE,
    ADD COLUMN employee_id UUID REFERENCES employees (id),
    ADD CONSTRAINT scans_saved_check CHECK (
        (state = 'saved') = (document_id IS NOT NULL) AND (document_id IS NULL) = (employee_id IS NULL));
CREATE INDEX scans_document_idx ON personnel.scans (document_id) WHERE document_id IS NOT NULL;
