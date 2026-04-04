DROP INDEX IF EXISTS idx_stays_active_tenant;

ALTER TABLE stays ALTER COLUMN bed_id SET NOT NULL;

ALTER TABLE tenants
    DROP COLUMN IF EXISTS id_proof_back_url,
    DROP COLUMN IF EXISTS id_proof_front_url,
    DROP COLUMN IF EXISTS aadhaar_number,
    DROP COLUMN IF EXISTS workplace,
    DROP COLUMN IF EXISTS emergency_contact_phone,
    DROP COLUMN IF EXISTS emergency_contact_name,
    DROP COLUMN IF EXISTS address;
