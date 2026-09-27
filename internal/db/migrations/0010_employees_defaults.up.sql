-- Defaults so a row can be inserted without spelling out its id and
-- timestamps (e.g. from a database tool). The API always sets all three.
-- The actor columns get no default: they reference users, and a row must be
-- attributed to a real user.
ALTER TABLE employees ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE employees ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE employees ALTER COLUMN updated_at SET DEFAULT now();
