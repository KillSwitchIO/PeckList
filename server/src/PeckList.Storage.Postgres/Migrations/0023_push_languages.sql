-- The languages the browser asked for when it subscribed (PL-148), "de-DE,de,en": a push in a
-- person's automatic language follows the device it goes to. Null for subscriptions from before.
ALTER TABLE push_subscriptions ADD COLUMN languages TEXT;
