-- v0.2: gap-free numbering, payments, credit notes, cancelling, change history.

-- ---- Gap-free numbering --------------------------------------------------
-- One counter row per series (e.g. "INV:2026" = bills of financial year 2026-27, "CN:2026" = credit notes).
-- The counter is bumped inside the same transaction that saves the document, so if the save fails the number
-- is never used up, and concurrent saves queue on the row lock. (The old bill_no_seq sequence cannot do this:
-- a sequence value is never given back after a rollback. It is left in place for the v0.1 bills.)
CREATE TABLE number_series (
  series     TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL
);

-- ---- Bills: due date and cancelling --------------------------------------
ALTER TABLE bills ADD COLUMN due_date DATE;
ALTER TABLE bills ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled'));
ALTER TABLE bills ADD COLUMN cancelled_at TIMESTAMPTZ;
ALTER TABLE bills ADD COLUMN cancelled_by INTEGER REFERENCES users (id);
ALTER TABLE bills ADD COLUMN cancel_reason TEXT;

-- ---- Payments ------------------------------------------------------------
-- A payment is never deleted: a wrong one is voided (kept, with who and why), so the history stays honest.
CREATE TABLE payments (
  id           SERIAL PRIMARY KEY,
  bill_id      INTEGER NOT NULL REFERENCES bills (id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  paid_on      DATE NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')),
  reference    TEXT,
  notes        TEXT,
  created_by   INTEGER NOT NULL REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at    TIMESTAMPTZ,
  voided_by    INTEGER REFERENCES users (id),
  void_reason  TEXT
);
CREATE INDEX idx_payments_bill ON payments (bill_id);

-- ---- Credit notes --------------------------------------------------------
-- Correct an issued bill without editing it: a credit note reduces what the client owes.
CREATE TABLE credit_notes (
  id               SERIAL PRIMARY KEY,
  cn_no            TEXT NOT NULL UNIQUE,
  bill_id          INTEGER NOT NULL REFERENCES bills (id),
  cn_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  reason           TEXT NOT NULL,
  subtotal_paise   BIGINT NOT NULL,
  gst_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  gst_paise        BIGINT NOT NULL DEFAULT 0,
  total_paise      BIGINT NOT NULL CHECK (total_paise > 0),
  created_by       INTEGER NOT NULL REFERENCES users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_notes_bill ON credit_notes (bill_id);

CREATE TABLE credit_note_items (
  id               SERIAL PRIMARY KEY,
  credit_note_id   INTEGER NOT NULL REFERENCES credit_notes (id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  details          TEXT,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  line_total_paise BIGINT NOT NULL
);
CREATE INDEX idx_credit_note_items_cn ON credit_note_items (credit_note_id);

-- ---- Change history ------------------------------------------------------
-- Every important event on a bill, with who and when. For an edit, before_data holds the bill as it was
-- before the change, so the previous version can always be looked at.
CREATE TABLE bill_history (
  id          SERIAL PRIMARY KEY,
  bill_id     INTEGER NOT NULL REFERENCES bills (id),
  action      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  before_data JSONB,
  changed_by  INTEGER NOT NULL REFERENCES users (id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bill_history_bill ON bill_history (bill_id, id);

-- ---- Settings ------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('payment_terms_days', '15'),     -- default days from bill date to due date
  ('default_country_code', '91'),   -- used to build WhatsApp numbers from a 10-digit phone number
  ('backup_copy_dir', '')           -- second backup location (a USB drive, network share or cloud-synced folder)
ON CONFLICT (key) DO NOTHING;
