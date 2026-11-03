-- Groups admins manage (never synced). A membership row is one reason an account is in a group:
-- "manual" or an identity provider ("oidc:<name>"), so a sign-in only changes its own rows.
CREATE TABLE server_groups (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    name_key            TEXT NOT NULL UNIQUE,
    offered_for_sharing INTEGER NOT NULL,
    created_at          TEXT NOT NULL
);

CREATE TABLE server_group_members (
    group_id   TEXT NOT NULL,
    account_id TEXT NOT NULL,
    source     TEXT NOT NULL,
    PRIMARY KEY (group_id, account_id, source)
);
CREATE INDEX server_group_members_account ON server_group_members (account_id);
