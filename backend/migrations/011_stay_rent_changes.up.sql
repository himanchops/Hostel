-- Rent that changes partway through a stay.
--
-- Until now a stay had one rent_amount and every figure was rent × cycles, so
-- raising a long tenant's rent repriced every month already lived — months
-- paid in full turned into arrears. A row here says "from this date, rent is
-- this much", and applies to every billing cycle that BEGINS on or after it.
--
-- Rows exist only for stays whose rent has changed. The first change writes
-- two: the original rent from the stay's start date, and the new one — so a
-- stay with rows here carries its whole schedule, and a stay without any bills
-- flat at stays.rent_amount exactly as before. stays.rent_amount is kept equal
-- to the latest scheduled rent, so every screen that only shows "the rent"
-- needs no change.
--
-- Correcting the rent for the whole stay (a typo at move-in) deletes the rows
-- and sets stays.rent_amount, which is the old behaviour on purpose.
CREATE TABLE stay_rent_changes (
    id             BIGSERIAL PRIMARY KEY,
    stay_id        BIGINT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    effective_date DATE   NOT NULL,
    rent_amount    BIGINT NOT NULL CHECK (rent_amount > 0), -- paise per cycle
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stay_id, effective_date)
);
