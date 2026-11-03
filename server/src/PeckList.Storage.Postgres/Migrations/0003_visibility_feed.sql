-- Access changes join the change feed: a grant re-announces an entity the user could not see
-- before (it may sit behind their cursor), a revocation tells them to remove it.
ALTER TABLE visibility ADD COLUMN granted_seq BIGINT NOT NULL DEFAULT 0;
CREATE INDEX visibility_user_granted ON visibility (user_id, granted_seq);

CREATE TABLE revocations (
    user_id   TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    seq       BIGINT NOT NULL,
    PRIMARY KEY (user_id, entity_id)
);
CREATE INDEX revocations_user_seq ON revocations (user_id, seq);
