-- Extend tenant profile with richer fields
ALTER TABLE tenants
    ADD COLUMN address TEXT,
    ADD COLUMN emergency_contact_name VARCHAR(255),
    ADD COLUMN emergency_contact_phone VARCHAR(20),
    ADD COLUMN workplace VARCHAR(255),
    ADD COLUMN aadhaar_number VARCHAR(20),
    ADD COLUMN id_proof_front_url TEXT,
    ADD COLUMN id_proof_back_url TEXT;

-- Allow stays without a bed assigned (deposit collected before room assignment)
ALTER TABLE stays ALTER COLUMN bed_id DROP NOT NULL;

-- Index for per-tenant active stay check (one active stay per tenant)
CREATE INDEX idx_stays_active_tenant ON stays(tenant_id) WHERE end_date IS NULL;
