-- Details printed on the professional invoice, as on the firm's own bills.

-- A file reference for each client (e.g. "BHAVIK SMS"), printed on the bill as "File No.".
ALTER TABLE clients ADD COLUMN file_no TEXT;

-- Firm details for the bill: a line under the firm name (e.g. "Tax Consultants"), the firm's mobile number,
-- its state with GST state code (e.g. "GUJARAT(24)"), the name under the signature, and the court jurisdiction.
INSERT INTO settings (key, value) VALUES
  ('org_tagline', ''),
  ('org_mobile', ''),
  ('org_state', ''),
  ('signatory_name', ''),
  ('jurisdiction', 'Ahmedabad')
ON CONFLICT (key) DO NOTHING;
