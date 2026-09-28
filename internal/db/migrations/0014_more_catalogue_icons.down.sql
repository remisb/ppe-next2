-- Items with a new pictogram fall back to the plain one it was drawn beside.
UPDATE catalogue_items SET icon = 'jacket' WHERE icon = 'insulated_jacket';
UPDATE catalogue_items SET icon = 'helmet' WHERE icon = 'welding_helmet';
ALTER TABLE catalogue_items DROP CONSTRAINT catalogue_items_icon_check;
ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_icon_check
    CHECK (icon IN ('shoes', 'jacket', 'trousers', 'vest', 'gloves', 'helmet', 'glasses', 'ear', 'mask', 'other'));
