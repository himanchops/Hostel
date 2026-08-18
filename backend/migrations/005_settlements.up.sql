-- Move-out settlements: deposit held − rent outstanding ± manual adjustments.
--
-- deposit_paise and dues_paise are SNAPSHOTS taken at settlement time, not
-- views onto the stay. The stay's rent or start date can be corrected later
-- (S1 made those editable), and a settlement is a record of money that
-- actually changed hands — it must not move when the underlying stay does.
CREATE TABLE settlements (
    id BIGSERIAL PRIMARY KEY,
    stay_id BIGINT NOT NULL UNIQUE REFERENCES stays(id) ON DELETE CASCADE,
    deposit_paise BIGINT NOT NULL,
    dues_paise BIGINT NOT NULL,              -- signed: negative = tenant had paid ahead
    adjustments JSONB NOT NULL DEFAULT '[]', -- [{"label":"Damaged chair","amount_paise":-50000}]
    refund_paise BIGINT NOT NULL,            -- deposit - dues + sum(adjustments); negative = tenant owes
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No separate index on stay_id: the UNIQUE constraint above already builds a
-- btree on it, which is the only way this table is ever looked up.
