-- Logins (never synced) and small values the server keeps for itself, such as the keys that
-- sign login cookies. Times are ISO 8601 text and flags 0/1 integers, alike on every database.
CREATE TABLE accounts (
    id                   TEXT PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE,
    password_hash        TEXT,
    role                 TEXT NOT NULL,
    must_change_password INTEGER NOT NULL,
    failed_logins        INTEGER NOT NULL,
    locked_until         TEXT,
    security_stamp       TEXT NOT NULL,
    disabled             INTEGER NOT NULL,
    created_at           TEXT NOT NULL
);

CREATE TABLE server_secrets (
    kind  TEXT NOT NULL,
    name  TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (kind, name)
);
