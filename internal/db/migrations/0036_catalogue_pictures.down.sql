-- Each item takes back a size group of its own: its picture's.
ALTER TABLE catalogue_items ADD COLUMN size_group TEXT;
UPDATE catalogue_items i SET size_group = p.size_group FROM catalogue_pictures p WHERE p.icon = i.icon;
ALTER TABLE catalogue_items ALTER COLUMN size_group SET NOT NULL;
ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_size_group_check
    CHECK (size_group IN ('CLOTHING', 'SHOES', 'NONE'));

ALTER TABLE catalogue_items DROP CONSTRAINT catalogue_items_icon_fkey;
ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_icon_check
    CHECK (icon IN ('shoes', 'jacket', 'insulated_jacket', 'trousers', 'vest', 'gloves',
                    'helmet', 'welding_helmet', 'glasses', 'ear', 'mask', 'other'));
DROP TABLE catalogue_pictures;
