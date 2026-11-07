-- The firm's logo, shown on bills. At most one row. Stored in the database so it is
-- included in the normal backups and needs no separate file to keep track of.
CREATE TABLE org_logo (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  content_type TEXT NOT NULL,
  data         BYTEA NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
