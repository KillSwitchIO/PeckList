-- The reminder a snooze was pressed on (0.14.0): its first time, in ms since the epoch, as the
-- reminder's notification tag names it ("<task>@<first>"). A snooze puts off that reminder alone (a
-- snooze made before it came no longer leaves it to come too), and a snooze of the same reminder
-- again replaces it. Null on snoozes from before, and from an API press that names no reminder:
-- those come as they did.
ALTER TABLE reminder_snoozes ADD COLUMN first_at BIGINT;
