-- The language an employee prefers: English, Lithuanian or Russian, the
-- languages the app speaks; not set for most until someone records it.
ALTER TABLE employees
    ADD COLUMN preferred_language TEXT
        CONSTRAINT employees_preferred_language_check CHECK (preferred_language IN ('en', 'lt', 'ru'));
