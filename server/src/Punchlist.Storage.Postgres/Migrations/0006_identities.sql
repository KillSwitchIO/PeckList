-- Identity provider accounts linked to ours, by the provider's never-changing subject, and people
-- a provider let in who wait for an admin because auto-create is off. Never synced.
CREATE TABLE identities (
    provider     TEXT NOT NULL,
    subject      TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    email        TEXT,
    linked_at    TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_account ON identities (account_id);

CREATE TABLE pending_signins (
    provider     TEXT NOT NULL,
    subject      TEXT NOT NULL,
    username     TEXT NOT NULL,
    display_name TEXT,
    email        TEXT,
    groups_json  TEXT NOT NULL,
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
);
