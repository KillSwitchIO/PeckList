-- Task history (R-FB-105): who changed which field of a task, from what to what (JSON values).
-- Times are Unix milliseconds; actor_id is null once the account is gone.
CREATE TABLE task_history (
    id         TEXT PRIMARY KEY,
    task_id    TEXT NOT NULL,
    at         INTEGER NOT NULL,
    actor_id   TEXT,
    field      TEXT NOT NULL,
    before_val TEXT,
    after_val  TEXT
);
CREATE INDEX task_history_task ON task_history (task_id, at);
CREATE INDEX task_history_actor ON task_history (actor_id);
