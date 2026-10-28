-- Which house rules a tenant agreed to when they registered, and when.
--
-- The owner wants everyone who registers from the QR link to read the rules
-- and tick each money rule before the form goes through (Oct 2026). The text
-- lives in the app (frontend/src/lib/houseRules.ts), one entry per version,
-- and a version is never edited once someone has agreed to it, so a tenant
-- row needs only the version's label, not a copy of the text.
--
-- Both nullable: tenants the owner adds by hand never see the form, and
-- everyone who registered before today agreed to nothing.
ALTER TABLE tenants ADD COLUMN rules_version TEXT;
ALTER TABLE tenants ADD COLUMN rules_agreed_at TIMESTAMPTZ;
