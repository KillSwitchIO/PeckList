-- Web Push (spec: PL-061): each browser's subscription, and the reminders already sent (so each
-- goes out once). Times are Unix milliseconds.
CREATE TABLE push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
CREATE TABLE sent_reminders (
    key TEXT PRIMARY KEY,
    at  INTEGER NOT NULL
);
