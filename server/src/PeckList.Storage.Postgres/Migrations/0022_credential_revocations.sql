-- Revoked API keys and removed passkeys, kept for good (0.14.0). A whole-server restore re-applies
-- them, so a key revoked because it leaked, or a passkey removed with a lost phone, does not come
-- back with an older backup, even once the key's own row is pruned or the passkey's is gone. They
-- travel in whole-server backups too. kind is 'apiKey' or 'passkey'; revoked_at is Unix
-- milliseconds. An account removed for good takes its rows with it.
CREATE TABLE credential_revocations (
    kind       TEXT NOT NULL,
    id         TEXT NOT NULL,
    account_id TEXT NOT NULL,
    revoked_at BIGINT NOT NULL,
    PRIMARY KEY (kind, id)
);
CREATE INDEX credential_revocations_account ON credential_revocations (account_id);
-- Keys revoked before this table: their rows say so until they are pruned.
INSERT INTO credential_revocations (kind, id, account_id, revoked_at)
    SELECT 'apiKey', id, user_id, revoked_at FROM api_keys WHERE revoked_at IS NOT NULL;
