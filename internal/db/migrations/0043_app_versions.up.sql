-- App Launcher, phase 3 (ADR 0006; docs/specs/app-launcher.md): an app's
-- published builds (versions, never changed), its channels (Stable, Beta,
-- Preview and named variants, each pointing at one version) and the channel
-- each user chose. The builds' files are in the published volume, served by
-- Caddy; the API answers each channel's index.html.
CREATE TABLE launcher_versions (
    id                   UUID PRIMARY KEY,
    app_id               UUID NOT NULL REFERENCES launcher_apps (id),
    -- YYYY.MM.DD-<commit>: the commit's date and abbreviation.
    version              TEXT NOT NULL CONSTRAINT launcher_versions_version_check
        CHECK (version ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9a-z][0-9a-z.-]{0,39}$'),
    -- standard, or device (WebAssembly, workers, the camera): the policy its pages get.
    profile              TEXT NOT NULL CONSTRAINT launcher_versions_profile_check CHECK (profile IN ('standard', 'device')),
    capabilities         TEXT[] NOT NULL DEFAULT '{}',
    commit               TEXT NOT NULL DEFAULT '',
    published_at         TIMESTAMPTZ NOT NULL,
    -- NULL when published by a deploy rather than a person.
    published_by_user_id UUID REFERENCES users (id),
    CONSTRAINT launcher_versions_app_version_key UNIQUE (app_id, version)
);

CREATE TABLE launcher_channels (
    id                 UUID PRIMARY KEY,
    app_id             UUID NOT NULL REFERENCES launcher_apps (id),
    -- stable, beta, preview, or a variant's own name.
    name               TEXT NOT NULL CONSTRAINT launcher_channels_name_check CHECK (name ~ '^[a-z][a-z0-9-]{1,30}$'),
    -- A variant's label in each language; '' for the three fixed channels, which the apps word.
    label_en           TEXT NOT NULL DEFAULT '' CONSTRAINT launcher_channels_label_en_check CHECK (char_length(label_en) <= 60),
    label_lt           TEXT NOT NULL DEFAULT '' CONSTRAINT launcher_channels_label_lt_check CHECK (char_length(label_lt) <= 60),
    label_ru           TEXT NOT NULL DEFAULT '' CONSTRAINT launcher_channels_label_ru_check CHECK (char_length(label_ru) <= 60),
    version_id         UUID NOT NULL REFERENCES launcher_versions (id),
    -- Who sees it beside the tile's audience: none means testers (apps.preview). Stable follows the tile.
    any_of             TEXT[] NOT NULL DEFAULT '{}',
    updated_at         TIMESTAMPTZ NOT NULL,
    updated_by_user_id UUID REFERENCES users (id),
    CONSTRAINT launcher_channels_app_name_key UNIQUE (app_id, name)
);

-- The channel each user opens an app on; none: Stable.
CREATE TABLE launcher_channel_choices (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    app_id  UUID NOT NULL REFERENCES launcher_apps (id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    PRIMARY KEY (user_id, app_id)
);

-- Scan SIMs is published under /apps/ from now on; its old address redirects.
UPDATE launcher_apps SET href = '/apps/sim-scan/' WHERE slug = 'sim-scan' AND href = '/sim-scan/';

-- Which build of an app an error came from (X-PPE-App-Version).
ALTER TABLE error_events ADD COLUMN app_version TEXT
    CONSTRAINT error_events_app_version_check CHECK (app_version ~ '^[0-9a-z][0-9a-z.-]{0,59}$');
