-- The confirmation wording each order was placed under (order.ConfirmationTexts).
-- A record always shows and hashes its own order's wording, so a later change of
-- wording never alters a stored record or its confirmed document hash. Every
-- order placed so far used 2026-09-v1. No default: the service always sets it.
ALTER TABLE orders ADD COLUMN receipt_text_version TEXT NOT NULL DEFAULT '2026-09-v1';
ALTER TABLE orders ALTER COLUMN receipt_text_version DROP DEFAULT;
