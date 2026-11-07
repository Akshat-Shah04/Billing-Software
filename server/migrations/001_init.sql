-- Money is stored as integer paise (1 rupee = 100 paise) so there are never
-- floating point rounding errors (0.1 + 0.2 is not exactly 0.3 in JavaScript).

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,        -- soft delete for staff
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  city       TEXT,
  pan        TEXT,
  gstin      TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,           -- soft delete
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_name ON clients (lower(name));

CREATE TABLE services (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('org_name', ''),
  ('org_address', ''),
  ('org_gstin', ''),
  ('gst_enabled', 'false'),
  ('gst_rate_percent', '18');

CREATE SEQUENCE bill_no_seq START 1;

CREATE TABLE bills (
  id               SERIAL PRIMARY KEY,
  bill_no          TEXT NOT NULL UNIQUE,
  client_id        INTEGER NOT NULL REFERENCES clients (id),
  bill_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  notes            TEXT,
  subtotal_paise   BIGINT NOT NULL,
  -- GST is a snapshot taken when the bill is created. Changing the admin
  -- setting later must never alter old bills.
  gst_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  gst_paise        BIGINT NOT NULL DEFAULT 0,
  total_paise      BIGINT NOT NULL,
  created_by       INTEGER NOT NULL REFERENCES users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       INTEGER REFERENCES users (id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bills_date ON bills (bill_date DESC, id DESC);
CREATE INDEX idx_bills_client ON bills (client_id);

CREATE TABLE bill_items (
  id               SERIAL PRIMARY KEY,
  bill_id          INTEGER NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
  service_id       INTEGER REFERENCES services (id),
  description      TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  line_total_paise BIGINT NOT NULL
);
CREATE INDEX idx_bill_items_bill ON bill_items (bill_id);
