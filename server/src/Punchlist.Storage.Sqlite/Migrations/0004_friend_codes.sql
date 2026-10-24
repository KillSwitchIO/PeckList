-- Each account's friend code (the /f/<code> link). Rotating it retires old links.
ALTER TABLE accounts ADD COLUMN friend_code TEXT;
CREATE UNIQUE INDEX accounts_friend_code ON accounts (friend_code);
