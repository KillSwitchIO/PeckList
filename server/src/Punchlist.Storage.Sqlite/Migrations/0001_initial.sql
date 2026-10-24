-- Entities as JSON documents, the change counter and who may see what (ADR-0004).
CREATE TABLE counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
INSERT INTO counters (name, value) VALUES ('seq', 0);

CREATE TABLE entities (
    id         TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    owner_id   TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    hlc        TEXT NOT NULL,
    deleted    INTEGER NOT NULL,
    doc        TEXT NOT NULL
);
CREATE UNIQUE INDEX entities_seq ON entities (seq);
CREATE INDEX entities_owner ON entities (owner_id, collection);

CREATE TABLE visibility (
    user_id   TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    PRIMARY KEY (user_id, entity_id)
);
CREATE INDEX visibility_entity ON visibility (entity_id);
