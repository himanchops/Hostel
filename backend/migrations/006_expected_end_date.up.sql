-- When a tenant is leaving, the owner knows two different dates and the schema
-- only had room for one.
--
--   notice_date        — the day they told you
--   expected_end_date  — the day they say they are going
--   end_date           — the day they actually went
--
-- Those are three facts, not one. Conflating the first two breaks the tenant
-- portal, where "I am giving notice" is stamped with today and would otherwise
-- read as "I leave today". Conflating the last two is worse: `end_date IS NULL`
-- is what "this stay is active" means everywhere in this app — the grid, the
-- revenue rollup, the occupancy series — so a future end_date frees the bed
-- while the person is still asleep in it.
--
-- expected_end_date is deliberately advisory. Nothing acts on it automatically:
-- no job ends a stay when it passes, because tenants overstay and leave early,
-- and only a human knows which happened. It drives what the owner is SHOWN —
-- a bed going orange as departure approaches, and a prompt to confirm once the
-- date has gone by — and nothing else.
ALTER TABLE stays ADD COLUMN expected_end_date DATE;

-- The dashboard's "Vacating Soon" list and the departures-to-confirm count both
-- filter on this being set and the stay still being open.
CREATE INDEX idx_stays_expected_end ON stays(expected_end_date)
    WHERE end_date IS NULL AND expected_end_date IS NOT NULL;
