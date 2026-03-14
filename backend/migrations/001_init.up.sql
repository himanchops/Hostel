-- Owners (multi-tenant root)
CREATE TABLE owners (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_owners_email ON owners(email);

-- Hostel Sites
CREATE TABLE hostel_sites (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hostel_sites_owner ON hostel_sites(owner_id);

-- Rooms
CREATE TABLE rooms (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES hostel_sites(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    floor INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rooms_site ON rooms(site_id);

-- Beds
CREATE TABLE beds (
    id BIGSERIAL PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_beds_room ON beds(room_id);

-- Tenants
CREATE TABLE tenants (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    id_proof_url TEXT,
    photo_url TEXT,
    is_approved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_owner ON tenants(owner_id);
CREATE INDEX idx_tenants_phone ON tenants(owner_id, phone);

-- Stays (occupancy records)
CREATE TYPE rent_cycle AS ENUM ('daily', 'weekly', 'monthly');

CREATE TABLE stays (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bed_id BIGINT NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
    rent_amount BIGINT NOT NULL, -- In paise (INR * 100)
    deposit_amount BIGINT NOT NULL DEFAULT 0,
    rent_cycle rent_cycle NOT NULL DEFAULT 'monthly',
    rent_due_day INT NOT NULL DEFAULT 1, -- Day of cycle when rent is due
    start_date DATE NOT NULL,
    end_date DATE,
    notice_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stays_tenant ON stays(tenant_id);
CREATE INDEX idx_stays_bed ON stays(bed_id);
CREATE INDEX idx_stays_active ON stays(bed_id) WHERE end_date IS NULL;

-- Payments
CREATE TYPE payment_type AS ENUM ('cash', 'online');

CREATE TABLE payments (
    id BIGSERIAL PRIMARY KEY,
    stay_id BIGINT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL, -- In paise
    payment_type payment_type NOT NULL DEFAULT 'cash',
    payment_date DATE NOT NULL,
    proof_url TEXT,
    notes TEXT,
    is_approved BOOLEAN NOT NULL DEFAULT TRUE, -- FALSE for tenant-submitted proofs
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_stay ON payments(stay_id);
CREATE INDEX idx_payments_date ON payments(stay_id, payment_date);
