-- A picture is the category a catalogue item belongs to: the pictogram the web
-- app draws and the size group of every item that has it. Until now each item
-- had its own size_group; from here an item's is its picture's, so changing a
-- picture's size group changes it for all of its items at once. Order lines
-- keep the size group they were ordered with (their own size_group column).
--
-- One row per pictogram, never added or deleted (ppe_app may only UPDATE it,
-- internal/db/grants.sql), and no actor columns: a foreign key to users would
-- let TRUNCATE users CASCADE empty it. Who changed a picture is on the audit
-- trail, under the row's fixed id.
CREATE TABLE catalogue_pictures (
    icon       TEXT PRIMARY KEY
        CONSTRAINT catalogue_pictures_icon_check
        CHECK (icon IN ('shoes', 'jacket', 'insulated_jacket', 'trousers', 'vest', 'gloves',
                        'helmet', 'welding_helmet', 'glasses', 'ear', 'mask', 'other')),
    id         UUID NOT NULL UNIQUE,
    size_group TEXT NOT NULL
        CONSTRAINT catalogue_pictures_size_group_check CHECK (size_group IN ('CLOTHING', 'SHOES', 'NONE'))
);

INSERT INTO catalogue_pictures (icon, id, size_group) VALUES
    ('shoes',            'c0a71c00-0000-4000-8000-000000000001', 'SHOES'),
    ('jacket',           'c0a71c00-0000-4000-8000-000000000002', 'CLOTHING'),
    ('insulated_jacket', 'c0a71c00-0000-4000-8000-000000000003', 'CLOTHING'),
    ('trousers',         'c0a71c00-0000-4000-8000-000000000004', 'CLOTHING'),
    ('vest',             'c0a71c00-0000-4000-8000-000000000005', 'CLOTHING'),
    ('gloves',           'c0a71c00-0000-4000-8000-000000000006', 'NONE'),
    ('helmet',           'c0a71c00-0000-4000-8000-000000000007', 'NONE'),
    ('welding_helmet',   'c0a71c00-0000-4000-8000-000000000008', 'NONE'),
    ('glasses',          'c0a71c00-0000-4000-8000-000000000009', 'NONE'),
    ('ear',              'c0a71c00-0000-4000-8000-00000000000a', 'NONE'),
    ('mask',             'c0a71c00-0000-4000-8000-00000000000b', 'NONE'),
    ('other',            'c0a71c00-0000-4000-8000-00000000000c', 'NONE');

-- Live items with one picture must agree on its size group, or one of them
-- would change size group silently: refuse, naming them, so someone gives them
-- the right pictures first.
DO $$
DECLARE
    conflicts TEXT;
BEGIN
    SELECT string_agg(format('%s (%s)', icon, items), '; ') INTO conflicts
    FROM (SELECT icon, string_agg(format('%s: %s', name, size_group), ', ' ORDER BY name) AS items
          FROM catalogue_items WHERE deleted_at IS NULL
          GROUP BY icon HAVING count(DISTINCT size_group) > 1) x;
    IF conflicts IS NOT NULL THEN
        RAISE EXCEPTION 'catalogue items with one picture have different size groups: %', conflicts;
    END IF;
END;
$$;

-- Each picture in use keeps the size group its items had.
UPDATE catalogue_pictures p SET size_group = x.size_group
FROM (SELECT icon, min(size_group) AS size_group FROM catalogue_items WHERE deleted_at IS NULL GROUP BY icon) x
WHERE p.icon = x.icon;

ALTER TABLE catalogue_items DROP CONSTRAINT catalogue_items_icon_check;
ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_icon_fkey
    FOREIGN KEY (icon) REFERENCES catalogue_pictures (icon);
ALTER TABLE catalogue_items DROP COLUMN size_group;
