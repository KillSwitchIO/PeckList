-- Notifications (spec: PL-061): who is told what, ids only (the app shows names from its own data).
-- Times are Unix milliseconds; read_at is null while unread.
CREATE TABLE notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    at         BIGINT NOT NULL,
    actor_id   TEXT,
    task_id    TEXT,
    list_id    TEXT,
    comment_id TEXT,
    read_at    BIGINT
);
CREATE INDEX notifications_user_at ON notifications (user_id, at);
