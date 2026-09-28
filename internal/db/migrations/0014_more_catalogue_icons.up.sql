-- Two more catalogue pictograms: a welding helmet and an insulated (quilted)
-- jacket, beside the plain helmet and jacket. Existing items keep their
-- pictogram; a manager picks a new one in Edit Item.
ALTER TABLE catalogue_items DROP CONSTRAINT catalogue_items_icon_check;
ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_icon_check
    CHECK (icon IN ('shoes', 'jacket', 'insulated_jacket', 'trousers', 'vest', 'gloves',
                    'helmet', 'welding_helmet', 'glasses', 'ear', 'mask', 'other'));
