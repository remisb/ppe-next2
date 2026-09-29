-- A manager can delete an order (demo and test orders): a soft delete, like
-- every other record. The row, its snapshot lines, its confirmations and the
-- audit trail stay; every read filters deleted_at IS NULL. Record numbers
-- are never reused, so a deleted order leaves a gap in the sequence.
ALTER TABLE orders
    ADD COLUMN deleted_at         TIMESTAMPTZ,
    ADD COLUMN deleted_by_user_id UUID REFERENCES users (id),
    ADD CONSTRAINT orders_deleted_fields CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL));
