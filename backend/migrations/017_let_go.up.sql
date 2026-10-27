-- Money the owner let go: "they owe ₹10,000, we're letting ₹2,000 go"
-- (owner, Oct 2026).
--
-- It is never a payment. Rent collected, the dashboard's Collected and every
-- cash figure ignore this table; what someone OWES counts it, the way a rent
-- payment would, so it covers their oldest unpaid month first.
--
-- On a stay that has been settled, an entry made after the settlement comes
-- off what the leaver still owes (settledOwed); one made before was already
-- counted in the settlement's dues, like a payment.
--
-- for_month is the month it comes off, fixed when it is made: the oldest
-- month still unpaid then, or the month they left for a settled stay.
-- Insights lowers that month's expected rent by it.
CREATE TABLE rent_let_go (
    id BIGSERIAL PRIMARY KEY,
    stay_id BIGINT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL CHECK (amount > 0), -- In paise
    for_month DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rent_let_go_stay ON rent_let_go(stay_id);
