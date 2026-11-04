-- A person's email (PL-122), lowercase, and when it was confirmed (a link opened, or a provider that
-- vouches for it). Reset links only ever go to a confirmed one.
ALTER TABLE accounts ADD COLUMN email TEXT;
ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;
CREATE INDEX accounts_email ON accounts (email);
