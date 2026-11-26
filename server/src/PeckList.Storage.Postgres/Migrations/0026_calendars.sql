-- Calendar sync (PL-134): a person's connected calendar accounts, how each of their calendars is
-- used, and each linked event as the last run left it. Server-side only (not workspace entities):
-- never in exports or snapshots, and left out of backups. The secret is encrypted at rest.
CREATE TABLE calendar_accounts (
    id         TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider   TEXT NOT NULL,
    name       TEXT NOT NULL,
    server_url TEXT NOT NULL,
    username   TEXT,
    secret     TEXT NOT NULL,
    status     TEXT NOT NULL,
    problem    TEXT,
    created_at BIGINT NOT NULL
);
CREATE INDEX calendar_accounts_account ON calendar_accounts (account_id);
CREATE TABLE calendar_links (
    id                  TEXT PRIMARY KEY,
    calendar_account_id TEXT NOT NULL,
    account_id          TEXT NOT NULL,
    remote_id           TEXT NOT NULL,
    name                TEXT NOT NULL,
    color               TEXT,
    read_only           INTEGER NOT NULL,
    mode                TEXT NOT NULL,
    tag_id              TEXT,
    list_id             TEXT,
    made_by_pecklist    INTEGER NOT NULL,
    sync_token          TEXT,
    task_cursor         BIGINT NOT NULL,
    channel_id          TEXT,
    channel_resource    TEXT,
    channel_expires     BIGINT,
    channel_token_hash  TEXT,
    synced_at           BIGINT,
    problem             TEXT,
    failures            INTEGER NOT NULL,
    next_attempt        BIGINT,
    UNIQUE (calendar_account_id, remote_id)
);
CREATE INDEX calendar_links_account ON calendar_links (account_id);
CREATE TABLE calendar_items (
    link_id       TEXT NOT NULL,
    event_id      TEXT NOT NULL,
    task_id       TEXT,
    etag          TEXT NOT NULL,
    event_json    TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    hidden_json   TEXT,
    updated_at    BIGINT NOT NULL,
    PRIMARY KEY (link_id, event_id)
);
CREATE INDEX calendar_items_task ON calendar_items (task_id);
