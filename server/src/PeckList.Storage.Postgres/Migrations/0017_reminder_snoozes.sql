-- A person's snoozed reminders (audit B3): Snooze on a reminder puts it off for that person only,
-- instead of adding a reminder to the task that every assignee would get. One row per snooze, kept
-- until a week after it is due; it is not a workspace entity and goes nowhere else. Unix milliseconds.
CREATE TABLE reminder_snoozes (
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    at      BIGINT NOT NULL,
    PRIMARY KEY (user_id, task_id, at)
);
CREATE INDEX reminder_snoozes_at ON reminder_snoozes (at);
