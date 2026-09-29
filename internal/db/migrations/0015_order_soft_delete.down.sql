-- Orders deleted since 0015 come back: the columns that hid them are gone.
ALTER TABLE orders
    DROP CONSTRAINT orders_deleted_fields,
    DROP COLUMN deleted_by_user_id,
    DROP COLUMN deleted_at;
