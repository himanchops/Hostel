-- Correcting a payment instead of deleting it and typing it again.
--
-- payment_edits keeps what a payment said before each change, so the ledger
-- can say "changed 27 Oct, was ₹8,000" and nobody has to remember why a
-- figure moved (owner, Oct 2026). Old values only; the payment row is always
-- the current truth, so no money query needs to know this table exists.
CREATE TABLE payment_edits (
    id BIGSERIAL PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    payment_type payment_type NOT NULL,
    kind payment_kind NOT NULL,
    payment_date DATE NOT NULL,
    notes TEXT,
    edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_edits_payment ON payment_edits(payment_id, edited_at);

-- Who put the payment on the ledger. A tenant's submission is never deleted,
-- only marked not accepted (migration 009), even after the owner first
-- accepted it; the owner's own entries can be deleted.
--
-- Backfill: the owner's form has always saved is_approved = true and no
-- proof, so a row that waited for approval, was rejected, or carries a proof
-- came from the portal. An approved portal payment with no proof can't be
-- told apart and stays false, which only means its sheet offers Delete.
ALTER TABLE payments ADD COLUMN from_tenant BOOLEAN NOT NULL DEFAULT false;
UPDATE payments SET from_tenant = true
 WHERE proof_url IS NOT NULL OR is_approved = false OR rejected_at IS NOT NULL;
