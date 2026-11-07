-- The service's description, copied onto the bill line when the bill is made.
-- It is a snapshot: editing the service later must not change bills already issued.
ALTER TABLE bill_items ADD COLUMN details TEXT;
