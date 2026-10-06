-- An item has two prices: the purchase price, what the supplier charges, and
-- the accounting price, what the organisation books and every order shows
-- (until now the only price, unit_price_cents). The purchase price is
-- optional: an item without one can still be ordered. Order lines snapshot
-- both; lines written before this migration have no purchase price.
-- order_lines' immutability trigger fires on row UPDATE/DELETE only, so the
-- column changes below leave the lines themselves untouched.
ALTER TABLE catalogue_items RENAME COLUMN unit_price_cents TO accounting_price_cents;
ALTER TABLE catalogue_items RENAME CONSTRAINT catalogue_items_unit_price_cents_check
    TO catalogue_items_accounting_price_cents_check;
ALTER TABLE catalogue_items
    ADD COLUMN purchase_price_cents BIGINT
        CONSTRAINT catalogue_items_purchase_price_cents_check CHECK (purchase_price_cents >= 0);

ALTER TABLE order_lines RENAME COLUMN unit_price_cents TO accounting_price_cents;
ALTER TABLE order_lines RENAME CONSTRAINT order_lines_unit_price_cents_check
    TO order_lines_accounting_price_cents_check;
ALTER TABLE order_lines
    ADD COLUMN purchase_price_cents BIGINT
        CONSTRAINT order_lines_purchase_price_cents_check CHECK (purchase_price_cents >= 0);
