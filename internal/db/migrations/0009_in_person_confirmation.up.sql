-- A third way to confirm receipt: IN_PERSON, the employee confirming on a staff
-- member's device at the counter (hand-over mode). Like PAPER it has no token
-- and records the signed-in staff member as giver; like ELECTRONIC the employee
-- ticks the confirmation text themselves.
ALTER TABLE orders DROP CONSTRAINT orders_confirmation_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_confirmation_method_check
    CHECK (confirmation_method IN ('ELECTRONIC', 'PAPER', 'IN_PERSON'));

ALTER TABLE order_confirmations DROP CONSTRAINT order_confirmations_method_check;
ALTER TABLE order_confirmations ADD CONSTRAINT order_confirmations_method_check
    CHECK (method IN ('ELECTRONIC', 'PAPER', 'IN_PERSON'));

ALTER TABLE order_confirmations DROP CONSTRAINT order_confirmations_token_shape;
ALTER TABLE order_confirmations ADD CONSTRAINT order_confirmations_token_shape CHECK (
    (method = 'ELECTRONIC' AND token_hash IS NOT NULL AND expires_at IS NOT NULL)
    OR (method IN ('PAPER', 'IN_PERSON') AND token_hash IS NULL AND expires_at IS NULL)
);
