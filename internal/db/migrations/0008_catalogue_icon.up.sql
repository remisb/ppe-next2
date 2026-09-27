-- A pictogram per catalogue item, so people recognise an item by its picture
-- (Add Item, the catalogue, order lines) as well as by its name. A fixed set:
-- the web app draws each one. Existing items get one guessed from their name;
-- anything unrecognised is 'other' until a manager chooses.
ALTER TABLE catalogue_items
    ADD COLUMN icon TEXT NOT NULL DEFAULT 'other'
        CHECK (icon IN ('shoes', 'jacket', 'trousers', 'vest', 'gloves', 'helmet', 'glasses', 'ear', 'mask', 'other'));

UPDATE catalogue_items SET icon = CASE
    WHEN name ~* '(shoe|boot)' THEN 'shoes'
    WHEN name ~* '(jacket|coat|parka)' THEN 'jacket'
    WHEN name ~* '(trouser|pants|overall)' THEN 'trousers'
    WHEN name ~* 'vest' THEN 'vest'
    WHEN name ~* 'glove' THEN 'gloves'
    WHEN name ~* '(helmet|hard hat|cap)' THEN 'helmet'
    WHEN name ~* '(glass|goggle|visor)' THEN 'glasses'
    WHEN name ~* '(ear|hearing)' THEN 'ear'
    WHEN name ~* '(mask|respirator)' THEN 'mask'
    ELSE 'other'
END;
