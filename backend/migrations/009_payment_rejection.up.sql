-- A payment proof the owner does not accept is kept, marked, and explained.
--
-- Rejecting used to DELETE the row. The tenant's submission vanished from
-- their ledger with no status and no reason, and nothing showed they had ever
-- claimed to pay (UX audit M6). A proof the owner could not match to money
-- received is exactly the one both sides will want to talk about later.
--
-- A rejected payment is never money: is_approved stays false, so every sum that
-- asks `p.is_approved = true` already leaves it out. What changes is the
-- pending queue, which must now ask `rejected_at IS NULL` as well.
ALTER TABLE payments
    ADD COLUMN rejected_at TIMESTAMPTZ,
    ADD COLUMN rejection_reason TEXT,
    ADD CONSTRAINT payments_rejected_not_approved
        CHECK (rejected_at IS NULL OR is_approved = false);
