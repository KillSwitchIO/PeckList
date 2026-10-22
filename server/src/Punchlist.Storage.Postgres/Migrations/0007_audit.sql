-- The access and event log (spec: Access and event log). Apart from synced data, never in backups;
-- times are Unix milliseconds.
CREATE TABLE audit_entries (
    id          TEXT PRIMARY KEY,
    at          BIGINT NOT NULL,
    kind        TEXT NOT NULL,
    type        TEXT NOT NULL,
    outcome     TEXT NOT NULL,
    actor_id    TEXT,
    actor_name  TEXT,
    by_id       TEXT,
    by_name     TEXT,
    target_id   TEXT,
    target_name TEXT,
    ip          TEXT,
    device      TEXT,
    method      TEXT,
    route       TEXT,
    status      INTEGER,
    duration_ms INTEGER,
    request_id  TEXT,
    detail      TEXT
);
CREATE INDEX audit_entries_kind_at ON audit_entries (kind, at);
CREATE INDEX audit_entries_actor ON audit_entries (actor_id);
