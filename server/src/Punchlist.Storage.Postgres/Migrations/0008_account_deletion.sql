-- Accounts an admin deleted: turned off at once and removed for good after the grace period.
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
