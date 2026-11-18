-- The occurrence a snooze is for (0.13.0-rc.2): the task's date (its start, else its due date) when
-- it was snoozed. Completing a repeating task leaves it open on its next date, and the snooze of the
-- one done must not come back on it; a snooze whose task has moved to another date is dropped too.
-- Null on snoozes from before (they last a week at most) and on tasks with no date.
ALTER TABLE reminder_snoozes ADD COLUMN occurrence TEXT;
