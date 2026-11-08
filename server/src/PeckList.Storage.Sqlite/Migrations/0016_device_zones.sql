-- The time zone a person's apps last reported (the device's own, an IANA name), for what the server
-- works out for them when they picked none and TZ is not set: reminders, snooze, the next repeat. One
-- per person, the latest report; it is not a workspace entity and goes nowhere else. Unix milliseconds.
CREATE TABLE device_zones (
    user_id     TEXT PRIMARY KEY,
    zone        TEXT NOT NULL,
    reported_at INTEGER NOT NULL
);
