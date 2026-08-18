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
    advance_returned_paise BIGINT NOT NULL DEFAULT 0, -- of a negative dues, how much went back
    adjustments JSONB NOT NULL DEFAULT '[]', -- [{"label":"Damaged chair","amount_paise":-50000}]
    refund_paise BIGINT NOT NULL,            -- deposit - dues + sum(adjustments); negative = tenant owes
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- advance_returned_paise is a decision, not a derivation. When a tenant has
-- paid ahead, returning all of it, some of it, or none is the owner's call at
-- the counter, and the settlement has to record which was made — otherwise the
-- row cannot be told apart from one where no advance existed. It is 0 whenever
-- dues_paise >= 0.

-- No separate index on stay_id: the UNIQUE constraint above already builds a
-- btree on it, which is the only way this table is ever looked up.
