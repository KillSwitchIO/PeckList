-- Who has shown they hold a file's bytes (1.0): only attachments whose owner holds the file let
-- anyone download it, so a hash on its own is no key to the bytes. A person becomes a holder by
-- uploading the bytes (checked every time), or by attaching a file they could already download.
-- Everyone who has an attachment today held its file when they added it: one row per distinct
-- (file, owner) of every attachment, deleted ones too (they can still come back), keeps every file
-- readable for everyone who reads it now. The bytes going (attachment cleanup) takes their rows.
CREATE TABLE file_holders (
    sha256     TEXT NOT NULL,
    account_id TEXT NOT NULL,
    PRIMARY KEY (sha256, account_id)
);
CREATE INDEX file_holders_account ON file_holders (account_id);
INSERT INTO file_holders (sha256, account_id)
    SELECT DISTINCT doc->>'sha256', owner_id FROM entities
    WHERE collection = 'attachments' AND doc->>'sha256' IS NOT NULL;
