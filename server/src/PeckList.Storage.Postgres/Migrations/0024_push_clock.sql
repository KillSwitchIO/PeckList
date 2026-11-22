-- The clock the device's browser reads by its own default (schema 22), reported with its
-- subscription, so on an automatic language a push reads as the app there does (an en-GB browser
-- asking for en-US reads 24-hour): 1 for 24-hour, 0 for 12-hour, null from before and from apps
-- that don't say.
ALTER TABLE push_subscriptions ADD COLUMN clock24 INTEGER;
