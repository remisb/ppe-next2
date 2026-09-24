-- Confirmation links and their evidence. Only the SHA-256 of a token is stored.
-- A link is usable while not expired, not revoked and not yet confirmed.
-- Paper confirmations have no token.
CREATE TABLE order_confirmations (
    id                 UUID PRIMARY KEY,
    order_id           UUID NOT NULL REFERENCES orders (id),
    method             TEXT NOT NULL CHECK (method IN ('ELECTRONIC', 'PAPER')),
    token_hash         TEXT UNIQUE,
    expires_at         TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    confirmed_at       TIMESTAMPTZ,
    confirmed_name     TEXT,
    document_hash      TEXT,
    created_at         TIMESTAMPTZ NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    CONSTRAINT order_confirmations_token_shape CHECK (
        (method = 'ELECTRONIC' AND token_hash IS NOT NULL AND expires_at IS NOT NULL)
        OR (method = 'PAPER' AND token_hash IS NULL AND expires_at IS NULL)
    ),
    CONSTRAINT order_confirmations_evidence CHECK (
        (confirmed_at IS NULL AND confirmed_name IS NULL AND document_hash IS NULL)
        OR (confirmed_at IS NOT NULL AND confirmed_name IS NOT NULL AND document_hash IS NOT NULL)
    )
);

-- At most one confirmation per order carries evidence.
CREATE UNIQUE INDEX order_confirmations_one_confirmed_idx ON order_confirmations (order_id) WHERE confirmed_at IS NOT NULL;
CREATE INDEX order_confirmations_order_idx ON order_confirmations (order_id);
