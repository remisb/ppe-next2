-- Administration's Usage screen (docs/specs/usage-service.md).
--
-- user_activity: which signed-in users used which app on which day (UTC),
-- written once a day per user and app by the API (internal/usage), kept 400
-- days. It is how "active people" are counted: a sign-in lasts weeks, so
-- sign-ins alone undercount.
CREATE TABLE user_activity (
    day     DATE NOT NULL,
    user_id UUID NOT NULL REFERENCES users (id),
    app     TEXT NOT NULL CHECK (app IN ('workwear', 'admin', 'api')),
    PRIMARY KEY (day, user_id, app)
);

CREATE INDEX user_activity_user_idx ON user_activity (user_id, day);

-- The Dashboard's setup figures once a day, for their trend.
CREATE TABLE data_quality_samples (
    day                     DATE PRIMARY KEY,
    employees               INTEGER NOT NULL,
    employees_missing_sizes INTEGER NOT NULL,
    catalogue_active        INTEGER NOT NULL,
    catalogue_unpriced      INTEGER NOT NULL,
    item_sets_active        INTEGER NOT NULL
);

-- When an employee first opened a confirmation link, for the link funnel;
-- the opening is also an audit event on the order (order.confirmation_link_opened).
ALTER TABLE order_confirmations ADD COLUMN first_opened_at TIMESTAMPTZ;

INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'usage.read')
ON CONFLICT DO NOTHING;
