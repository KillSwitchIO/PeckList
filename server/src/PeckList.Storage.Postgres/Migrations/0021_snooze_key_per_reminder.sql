-- A snooze is one per person, task, time and reminder pressed (0.14.0). The key was (user, task,
-- time), so two reminders of one task snoozed to the same minute shared a row: the later press's
-- reminder (first_at) replaced the other's, which then also came at its own time. Snoozes that name
-- no reminder (first_at null: from before 0020, or an API press that names none) keep one row per
-- person, task and time, as before; those that name one get one per reminder.
ALTER TABLE reminder_snoozes DROP CONSTRAINT reminder_snoozes_pkey;
CREATE UNIQUE INDEX reminder_snoozes_unnamed ON reminder_snoozes (user_id, task_id, at) WHERE first_at IS NULL;
CREATE UNIQUE INDEX reminder_snoozes_reminder ON reminder_snoozes (user_id, task_id, at, first_at) WHERE first_at IS NOT NULL;
