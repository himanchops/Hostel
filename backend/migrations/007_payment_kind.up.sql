-- What a payment is FOR, as opposed to how it arrived (payment_type).
--
-- Until now every payment counted as rent, and the deposit a settlement
-- refunded was stays.deposit_amount — the figure agreed at intake, not money
-- anyone had received. So a tenant who paid nothing was offered their deposit
-- back, and a tenant whose deposit was written down as a payment got it back
-- twice: once as "deposit held" and again as rent paid in advance.
--
-- 'deposit' payments are held money: they never reduce rent dues, never count
-- as collected rent, and are the only thing a settlement refunds as a deposit.
-- stays.deposit_amount stays what it always was — the agreement — and the
-- settlement drawer shows the two side by side when they differ.
--
-- Every existing row becomes 'rent', which is what it was being counted as.
-- Nothing is backfilled: inventing a deposit payment for each stay would put
-- money in the ledger that nobody recorded receiving.
CREATE TYPE payment_kind AS ENUM ('rent', 'deposit');

ALTER TABLE payments ADD COLUMN kind payment_kind NOT NULL DEFAULT 'rent';
