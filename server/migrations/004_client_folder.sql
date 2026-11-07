-- Name of the client's folder on disk (a readable backup of their details and bills).
-- Stored so the folder can be found again, and renamed, when the client is renamed.
ALTER TABLE clients ADD COLUMN folder_name TEXT;
CREATE UNIQUE INDEX idx_clients_folder_name ON clients (lower(folder_name)) WHERE folder_name IS NOT NULL;
