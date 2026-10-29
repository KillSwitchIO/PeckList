-- API keys (R-FB-157): a person's named keys, what each may do (scopes, space-separated), and when
-- it was made, stops working, was last used or revoked (Unix milliseconds). Only a SHA-256 hash of
-- the secret is kept.
CREATE TABLE api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    secret_hash  TEXT NOT NULL,
    scopes       TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER,
    last_used_at INTEGER,
    revoked_at   INTEGER
);
CREATE INDEX api_keys_user ON api_keys (user_id);
