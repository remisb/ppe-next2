-- App Launcher's registry (ADR 0006, phase 2; docs/specs/app-launcher.md):
-- every app and shortcut it shows, who sees each (by permission), each user's
-- pinned tiles and the feedback people give on apps. The phase-1 tiles are
-- inserted by the API at start-up (launcher.EnsureDefaults), as built-in roles
-- are by role.EnsureBuiltins, so an emptied test database gets them back.
CREATE TABLE launcher_apps (
    id                 UUID PRIMARY KEY,
    slug               TEXT NOT NULL CONSTRAINT launcher_apps_slug_key UNIQUE
        CONSTRAINT launcher_apps_slug_check CHECK (slug ~ '^[a-z][a-z0-9-]{1,30}$'),
    kind               TEXT NOT NULL CONSTRAINT launcher_apps_kind_check CHECK (kind IN ('app', 'shortcut')),
    -- The slug of the app a shortcut opens a screen in; '' for an app.
    parent             TEXT NOT NULL DEFAULT '',
    app_group          TEXT NOT NULL CONSTRAINT launcher_apps_group_check
        CHECK (app_group IN ('workwear', 'assets', 'people', 'admin')),
    icon               TEXT NOT NULL CONSTRAINT launcher_apps_icon_check CHECK (icon ~ '^[a-z]+$'),
    color              TEXT NOT NULL CONSTRAINT launcher_apps_color_check CHECK (color ~ '^#[0-9a-f]{6}$'),
    href               TEXT NOT NULL CONSTRAINT launcher_apps_href_check CHECK (href <> '' AND char_length(href) <= 300),
    tier               TEXT NOT NULL CONSTRAINT launcher_apps_tier_check CHECK (tier IN ('here', 'linked')),
    stage              TEXT NOT NULL CONSTRAINT launcher_apps_stage_check
        CHECK (stage IN ('live', 'pilot', 'poc', 'dev', 'retired')),
    name_en            TEXT NOT NULL CONSTRAINT launcher_apps_name_en_check CHECK (char_length(name_en) BETWEEN 1 AND 60),
    name_lt            TEXT NOT NULL CONSTRAINT launcher_apps_name_lt_check CHECK (char_length(name_lt) BETWEEN 1 AND 60),
    name_ru            TEXT NOT NULL CONSTRAINT launcher_apps_name_ru_check CHECK (char_length(name_ru) BETWEEN 1 AND 60),
    -- Seen by a user holding any of these permissions; none: every signed-in user.
    any_of             TEXT[] NOT NULL DEFAULT '{}',
    position           INT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    -- NULL on the tiles the API inserts itself.
    updated_by_user_id UUID REFERENCES users (id),

    CONSTRAINT launcher_apps_parent_check CHECK ((kind = 'app') = (parent = '')),
    CONSTRAINT launcher_apps_shortcut_here CHECK (kind = 'app' OR tier = 'here')
);

-- Pinned tiles, per user, in the order they were pinned.
CREATE TABLE launcher_pins (
    user_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    app_id   UUID NOT NULL REFERENCES launcher_apps (id) ON DELETE CASCADE,
    position INT NOT NULL,
    PRIMARY KEY (user_id, app_id)
);

-- Feedback on an app, from its tile in App Launcher.
CREATE TABLE launcher_feedback (
    id         UUID PRIMARY KEY,
    app_id     UUID NOT NULL REFERENCES launcher_apps (id),
    user_id    UUID NOT NULL REFERENCES users (id),
    rating     TEXT NOT NULL CONSTRAINT launcher_feedback_rating_check CHECK (rating IN ('works', 'confusing', 'broken')),
    text       TEXT NOT NULL DEFAULT '' CONSTRAINT launcher_feedback_text_check CHECK (char_length(text) <= 2000),
    device     TEXT NOT NULL CONSTRAINT launcher_feedback_device_check CHECK (device IN ('phone', 'tablet', 'desktop')),
    language   TEXT NOT NULL CONSTRAINT launcher_feedback_language_check CHECK (language IN ('en', 'lt', 'ru')),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX launcher_feedback_app_idx ON launcher_feedback (app_id, created_at DESC);

-- Manage apps, the Administrator's (role.AdminID).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'apps.manage') ON CONFLICT DO NOTHING;

-- Testers, a built-in role that alone sees apps in testing (POC, In development).
ALTER TABLE roles DROP CONSTRAINT roles_key_known;
ALTER TABLE roles ADD CONSTRAINT roles_key_known
    CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee', 'equipment', 'testers'));
INSERT INTO roles (id, key, name, description, created_at, updated_at) VALUES
    ('a0e1d000-0000-4000-8000-000000000005', 'testers', 'Testers', 'Sees App Launcher''s apps in testing.', now(), now());
INSERT INTO role_permissions (role_id, permission) VALUES ('a0e1d000-0000-4000-8000-000000000005', 'apps.preview');

-- Apps are told apart by their slug (X-PPE-App), so the audit trail, the
-- security log, the error list and Usage accept any slug-shaped source, not
-- only workwear and admin.
ALTER TABLE audit_events DROP CONSTRAINT audit_events_source_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_source_check CHECK (source ~ '^[a-z][a-z0-9_-]{1,30}$');
ALTER TABLE auth_events DROP CONSTRAINT auth_events_source_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_source_check CHECK (source ~ '^[a-z][a-z0-9_-]{1,30}$');
ALTER TABLE error_events DROP CONSTRAINT error_events_source_check;
ALTER TABLE error_events ADD CONSTRAINT error_events_source_check CHECK (source ~ '^[a-z][a-z0-9_-]{1,30}$');
ALTER TABLE user_activity DROP CONSTRAINT user_activity_app_check;
ALTER TABLE user_activity ADD CONSTRAINT user_activity_app_check CHECK (app ~ '^[a-z][a-z0-9_-]{1,30}$');
