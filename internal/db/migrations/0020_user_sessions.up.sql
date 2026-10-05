-- Sign-ins (docs/specs/session-service.md): one row per sign-in on one
-- browser, which keeps it in an HttpOnly refresh cookie. The cookie's token is
-- never stored. It is an HMAC of the row's id, seed and generation under a key
-- the API derives from API_JWT_SECRET, so the API can check a token and send
-- the current one again, while a copy of this table cannot produce one. Each
-- refresh moves generation on; presenting an older one ends the sign-in.
CREATE TABLE user_sessions (
    id               UUID PRIMARY KEY,
    user_id          UUID NOT NULL REFERENCES users (id),
    seed             BYTEA NOT NULL,
    generation       INTEGER NOT NULL CHECK (generation >= 1),
    rotated_at       TIMESTAMPTZ NOT NULL,
    -- "Keep me signed in": a cookie that outlives the browser, the longer
    -- limit and an idle limit; without it the cookie ends with the browser.
    keep_signed_in   BOOLEAN NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    -- When the password was last entered: at sign-in, or to confirm it for
    -- managing users (API_RECENT_SIGN_IN).
    authenticated_at TIMESTAMPTZ NOT NULL,
    last_used_at     TIMESTAMPTZ NOT NULL,
    idle_expires_at  TIMESTAMPTZ NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ,
    end_reason       TEXT,
    -- The browser and address it was last used from, for the device list.
    user_agent       TEXT NOT NULL,
    ip               TEXT NOT NULL,

    CONSTRAINT user_sessions_end_pair CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
    CONSTRAINT user_sessions_end_reason_known CHECK (end_reason IN (
        'signed_out', 'ended_elsewhere', 'password_changed', 'password_reset',
        'deactivated', 'deleted', 'reused'
    ))
);

CREATE INDEX user_sessions_user_live_idx ON user_sessions (user_id) WHERE ended_at IS NULL;
