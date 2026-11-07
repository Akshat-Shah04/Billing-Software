-- Each line of a bill has its own financial year, shown on the bill in place of a quantity column.
-- One bill can cover work of several years, e.g. "Income Tax Return - 2023-24" and "Income Tax Return - 2024-25".
-- (The bill's own fy_start still decides its number series and where it is listed.)
ALTER TABLE bill_items ADD COLUMN fy_start INTEGER;

-- Existing lines take their bill's financial year.
UPDATE bill_items i SET fy_start = b.fy_start FROM bills b WHERE b.id = i.bill_id;

ALTER TABLE bill_items ALTER COLUMN fy_start SET NOT NULL;
ALTER TABLE bill_items ADD CONSTRAINT bill_items_fy_start_range CHECK (fy_start BETWEEN 1900 AND 9998);
