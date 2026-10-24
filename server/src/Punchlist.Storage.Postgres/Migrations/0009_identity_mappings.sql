-- The provider's username at the last sign-in, for admins telling identities apart, and admin-made
-- mappings: a provider username that always signs into a given account (spec: Accounts & Admin,
-- Linking and provider migration).
ALTER TABLE identities ADD COLUMN username TEXT;

CREATE TABLE identity_mappings (
    provider          TEXT NOT NULL,
    provider_username TEXT NOT NULL,
    account_id        TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    PRIMARY KEY (provider, provider_username)
);
