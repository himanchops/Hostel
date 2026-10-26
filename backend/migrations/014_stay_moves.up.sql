-- Moving a tenant to another bed partway through a stay.
--
-- The stay carries on: the deposit, the payments, what they owe and their rent
-- day are all the stay's, and a move changes none of them. stays.bed_id stays
-- the bed they are in now, so every current-state screen (grid, dashboard,
-- Payments) needs no change. A row here records one move, so history can say
-- where they slept on a given night: before the first move they were in its
-- from_bed, and from each move's date in its to_bed.
--
-- New rows only. Existing stays have no moves, and read exactly as before, so
-- the live account needs no backfill.
--
-- The bed columns go to NULL if a bed is deleted later. The move stays on
-- record; only which bed it was is lost.
CREATE TABLE stay_moves (
    id          BIGSERIAL PRIMARY KEY,
    stay_id     BIGINT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    from_bed_id BIGINT REFERENCES beds(id) ON DELETE SET NULL,
    to_bed_id   BIGINT REFERENCES beds(id) ON DELETE SET NULL,
    moved_on    DATE   NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX stay_moves_stay_id ON stay_moves (stay_id, moved_on);
