-- v0.4: an acknowledgement receipt for every payment received (full or part).
--
-- Each payment gets a receipt number in its own gap-free series per financial year of the payment date:
-- RCT/2026-27/0001, RCT/2026-27/0002, ... (series "RCT:2026" in number_series). A voided payment keeps its number
-- (the receipt is shown as VOID), so the series stays complete.

ALTER TABLE payments ADD COLUMN receipt_no TEXT;

-- Payments recorded before receipts existed are numbered now, in the order they were received.
WITH dated AS (
  SELECT id, paid_on,
         (EXTRACT(YEAR FROM paid_on)::int - CASE WHEN EXTRACT(MONTH FROM paid_on) < 4 THEN 1 ELSE 0 END) AS fy
  FROM payments
),
numbered AS (
  SELECT id, fy, ROW_NUMBER() OVER (PARTITION BY fy ORDER BY paid_on, id) AS n FROM dated
)
UPDATE payments p
SET receipt_no = 'RCT/' || numbered.fy || '-' || lpad(((numbered.fy + 1) % 100)::text, 2, '0') || '/' || lpad(numbered.n::text, 4, '0')
FROM numbered
WHERE numbered.id = p.id;

-- Continue each year's series after the numbers just given.
INSERT INTO number_series (series, last_value)
SELECT 'RCT:' || fy, COUNT(*)
FROM (SELECT (EXTRACT(YEAR FROM paid_on)::int - CASE WHEN EXTRACT(MONTH FROM paid_on) < 4 THEN 1 ELSE 0 END) AS fy FROM payments) x
GROUP BY fy
ON CONFLICT (series) DO UPDATE SET last_value = GREATEST(number_series.last_value, EXCLUDED.last_value);

ALTER TABLE payments ALTER COLUMN receipt_no SET NOT NULL;
CREATE UNIQUE INDEX idx_payments_receipt_no ON payments (receipt_no);
CREATE INDEX idx_payments_paid_on ON payments (paid_on);
