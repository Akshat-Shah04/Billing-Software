-- Discounts given AT PAYMENT TIME, when a client pays less than the bill and the firm agrees to settle
-- (e.g. a bill of 15,000 paid with 12,000). Nothing is assumed in advance: the bill is always issued and kept at
-- its full amount, and a discount exists only if someone records it when the client pays less.
-- Like payments, a discount is never deleted: a wrong one is voided (kept, with who and why).
CREATE TABLE discounts (
  id           SERIAL PRIMARY KEY,
  bill_id      INTEGER NOT NULL REFERENCES bills (id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  given_on     DATE NOT NULL,
  reason       TEXT NOT NULL,
  created_by   INTEGER NOT NULL REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at    TIMESTAMPTZ,
  voided_by    INTEGER REFERENCES users (id),
  void_reason  TEXT
);
CREATE INDEX idx_discounts_bill ON discounts (bill_id);
