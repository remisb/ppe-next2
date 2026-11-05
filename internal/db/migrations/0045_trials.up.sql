-- App Launcher's Trials view (ADR 0006, phase 5): for each published version,
-- who used it, the errors it had and the feedback given on it.

-- The days each user used each version of a published app (from the page's
-- X-PPE-App-Version), written once a day per user, app and version as
-- user_activity is, and kept as long (usage.ActivityKept).
CREATE TABLE user_version_activity (
    day     DATE NOT NULL,
    user_id UUID NOT NULL REFERENCES users (id),
    app     TEXT NOT NULL CONSTRAINT user_version_activity_app_check CHECK (app ~ '^[a-z][a-z0-9-]{1,30}$'),
    version TEXT NOT NULL CONSTRAINT user_version_activity_version_check CHECK (version ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9a-z][0-9a-z.-]{0,39}$'),
    PRIMARY KEY (day, user_id, app, version)
);

CREATE INDEX user_version_activity_app_idx ON user_version_activity (app, version, day);

-- The version the sender's tile opened when feedback was given; NULL for an
-- app with no versions, and for feedback from before.
ALTER TABLE launcher_feedback ADD COLUMN version TEXT;
