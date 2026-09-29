-- Each user's interface language: English, Lithuanian or Russian. The staff
-- app follows it on every device; the signed record stays English / Russian.
ALTER TABLE users
    ADD COLUMN language TEXT NOT NULL DEFAULT 'en'
        CONSTRAINT users_language_check CHECK (language IN ('en', 'lt', 'ru'));
