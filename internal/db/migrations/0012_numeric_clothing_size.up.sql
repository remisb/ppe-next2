-- Clothing sizes become EU numbers: the even sizes 44–66 (internal/domain/size
-- mirrors the list; keep the two in step). Saved letter sizes convert to the
-- number the height bands put them at. Order lines keep their size as TEXT and
-- are immutable, so lines ordered before this migration keep their letters.
ALTER TABLE employees DROP CONSTRAINT employees_clothing_size_check;

ALTER TABLE employees ALTER COLUMN clothing_size TYPE INTEGER USING CASE clothing_size
    WHEN 'S' THEN 46
    WHEN 'M' THEN 50
    WHEN 'L' THEN 54
    WHEN 'XL' THEN 58
    WHEN '2XL' THEN 62
    WHEN '3XL' THEN 66
END;

ALTER TABLE employees ADD CONSTRAINT employees_clothing_size_check
    CHECK (clothing_size BETWEEN 44 AND 66 AND clothing_size % 2 = 0);
