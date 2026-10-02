-- Organisation settings that administrators change in the app: one row at
-- most (singleton is always true). No row reads as the defaults, empty here,
-- so a database emptied by TRUNCATE users CASCADE still works.
CREATE TABLE app_settings (
    singleton          BOOLEAN PRIMARY KEY DEFAULT TRUE CONSTRAINT app_settings_singleton_check CHECK (singleton),
    -- The supplier's WhatsApp group: its name as staff know it, and its
    -- invite link (https://chat.whatsapp.com/<code>); both empty when unset.
    supplier_chat_name TEXT NOT NULL DEFAULT '',
    supplier_chat_link TEXT NOT NULL DEFAULT '',
    updated_at         TIMESTAMPTZ NOT NULL,
    updated_by_user_id UUID NOT NULL REFERENCES users (id)
);
