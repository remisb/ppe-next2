-- Back to letter sizes: each letter takes the two numbers nearest it, so every
-- saved size has somewhere to go.
ALTER TABLE employees DROP CONSTRAINT employees_clothing_size_check;

ALTER TABLE employees ALTER COLUMN clothing_size TYPE TEXT USING CASE
    WHEN clothing_size IN (44, 46) THEN 'S'
    WHEN clothing_size IN (48, 50) THEN 'M'
    WHEN clothing_size IN (52, 54) THEN 'L'
    WHEN clothing_size IN (56, 58) THEN 'XL'
    WHEN clothing_size IN (60, 62) THEN '2XL'
    WHEN clothing_size IN (64, 66) THEN '3XL'
END;

ALTER TABLE employees ADD CONSTRAINT employees_clothing_size_check
    CHECK (clothing_size IN ('S', 'M', 'L', 'XL', '2XL', '3XL'));
