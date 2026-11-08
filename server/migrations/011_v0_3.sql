-- v0.3: client groups, amounts paid on a client's behalf, password reset by email.

-- ---- Client groups --------------------------------------------------------
-- A family (or any set of related clients) handled together, e.g. "Shah family": the father, mother, HUF and children
-- each stay separate clients with their own bills, and the group gives one combined ledger and report.
CREATE TABLE client_groups (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_client_groups_name ON client_groups (lower(name));
ALTER TABLE clients ADD COLUMN group_id INTEGER REFERENCES client_groups (id);
CREATE INDEX idx_clients_group ON clients (group_id);

-- ---- Paid on the client's behalf -----------------------------------------
-- A bill line is either the firm's fee, or money the firm paid for the client (e.g. income tax paid from the firm's
-- bank account) that the client pays back. Paid-on-behalf lines carry no GST and are not the firm's income.
ALTER TABLE bill_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'fee' CHECK (kind IN ('fee', 'reimbursement'));
-- bills.subtotal_paise stays the FEES subtotal (GST is charged on it); the paid-on-behalf total is stored beside it,
-- and total_paise = subtotal + GST + reimbursement.
ALTER TABLE bills ADD COLUMN reimbursement_paise BIGINT NOT NULL DEFAULT 0 CHECK (reimbursement_paise >= 0);

-- ---- Password reset by email (administrators) -----------------------------
ALTER TABLE users ADD COLUMN email TEXT;
-- Sessions started before this time are refused, so changing a password logs out everywhere else.
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;

-- Only a hash of each reset token is stored: the token itself exists only in the email.
CREATE TABLE password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_resets_user ON password_resets (user_id);

-- Mail server for sending reset links, and the address staff use to open the software (for the link in the email).
INSERT INTO settings (key, value) VALUES
  ('smtp_host', ''),
  ('smtp_port', '587'),
  ('smtp_secure', 'false'),
  ('smtp_user', ''),
  ('smtp_password', ''),
  ('smtp_from', ''),
  ('app_url', '')
ON CONFLICT (key) DO NOTHING;
