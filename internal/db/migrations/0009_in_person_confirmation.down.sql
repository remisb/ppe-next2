-- Fails while any order or confirmation is IN_PERSON: those records cannot be
-- expressed in the older schema, and dropping them would lose evidence.
ALTER TABLE order_confirmations DROP CONSTRAINT order_confirmations_token_shape;
ALTER TABLE order_confirmations ADD CONSTRAINT order_confirmations_token_shape CHECK (
    (method = 'ELECTRONIC' AND token_hash IS NOT NULL AND expires_at IS NOT NULL)
    OR (method = 'PAPER' AND token_hash IS NULL AND expires_at IS NULL)
);

ALTER TABLE order_confirmations DROP CONSTRAINT order_confirmations_method_check;
ALTER TABLE order_confirmations ADD CONSTRAINT order_confirmations_method_check
    CHECK (method IN ('ELECTRONIC', 'PAPER'));

ALTER TABLE orders DROP CONSTRAINT orders_confirmation_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_confirmation_method_check
    CHECK (confirmation_method IN ('ELECTRONIC', 'PAPER'));
