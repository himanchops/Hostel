-- Billing is anchored to each stay's start_date (see handlers.cyclesElapsed):
-- a tenant who moves in on the 20th is billed on the 20th. rent_due_day was
-- written on create and returned by the API but never read by any billing code,
-- so it was dead configuration that looked meaningful.
ALTER TABLE stays DROP COLUMN rent_due_day;
