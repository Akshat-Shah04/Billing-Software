-- The financial year a bill belongs to is chosen when the bill is made, and is NOT worked out from the bill date.
-- An accountant often bills today for work of an earlier year (e.g. an audit for FY 2023-24 billed in 2026),
-- and old bills are entered into the system long after they were issued.
-- fy_start is the year the financial year starts in: 2026 means FY 2026-27 (1 Apr 2026 to 31 Mar 2027).
-- The bill number series, the year filter, totals and exports all use this column.

ALTER TABLE bills ADD COLUMN fy_start INTEGER;

-- Existing bills keep the year they had before (the one their date falls in).
UPDATE bills
SET fy_start = EXTRACT(YEAR FROM bill_date)::int - CASE WHEN EXTRACT(MONTH FROM bill_date) < 4 THEN 1 ELSE 0 END;

ALTER TABLE bills ALTER COLUMN fy_start SET NOT NULL;
ALTER TABLE bills ADD CONSTRAINT bills_fy_start_range CHECK (fy_start BETWEEN 1900 AND 9998);
CREATE INDEX idx_bills_fy_start ON bills (fy_start);
