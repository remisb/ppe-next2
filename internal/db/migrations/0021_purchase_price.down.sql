-- The purchase prices recorded since 0021 are lost.
ALTER TABLE order_lines DROP COLUMN purchase_price_cents;
ALTER TABLE order_lines RENAME CONSTRAINT order_lines_accounting_price_cents_check
    TO order_lines_unit_price_cents_check;
ALTER TABLE order_lines RENAME COLUMN accounting_price_cents TO unit_price_cents;

ALTER TABLE catalogue_items DROP COLUMN purchase_price_cents;
ALTER TABLE catalogue_items RENAME CONSTRAINT catalogue_items_accounting_price_cents_check
    TO catalogue_items_unit_price_cents_check;
ALTER TABLE catalogue_items RENAME COLUMN accounting_price_cents TO unit_price_cents;
