-- Where an account's role came from (audit S10 follow-up, R1): the provider whose ROLE_MAP gave it,
-- and when a sign-in through that provider last renewed it. A role nobody renews within
-- ROLE_MAP_RENEW_DAYS drops to user. Both are null for a role set by hand. Times as text, like the rest.
ALTER TABLE accounts ADD COLUMN role_provider TEXT;
ALTER TABLE accounts ADD COLUMN role_renewed_at TEXT;
