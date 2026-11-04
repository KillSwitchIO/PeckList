-- Passkeys (PL-123): WebAuthn credentials on accounts. Only the public key is kept (COSE, base64url),
-- with the signature counter, how the authenticator is reached, and whether it is synced (0/1).
-- Times are Unix milliseconds.
CREATE TABLE passkeys (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    public_key   TEXT NOT NULL,
    sign_count   INTEGER NOT NULL,
    transports   TEXT,
    backed_up    INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER
);
CREATE INDEX passkeys_account ON passkeys (account_id);
