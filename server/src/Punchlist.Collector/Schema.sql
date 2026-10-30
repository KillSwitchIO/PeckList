-- The collector's tables. Run on every start; each statement is safe to run again.

-- One row per install per day (UTC): the day's last ping. No IP address, ever.
CREATE TABLE IF NOT EXISTS pings (
    install_id  uuid        NOT NULL,
    day         date        NOT NULL,
    received_at timestamptz NOT NULL,
    schema      integer     NOT NULL,
    version     text        NOT NULL,
    channel     text        NOT NULL,
    payload     jsonb       NOT NULL,
    PRIMARY KEY (install_id, day)
);

CREATE INDEX IF NOT EXISTS pings_day ON pings (day);

-- Installs per value of each dimension per finished day, kept after the pings are pruned.
CREATE TABLE IF NOT EXISTS daily_totals (
    day       date    NOT NULL,
    dimension text    NOT NULL,
    value     text    NOT NULL,
    installs  integer NOT NULL,
    PRIMARY KEY (day, dimension, value)
);
