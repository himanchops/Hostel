-- Deposit payments fold back into rent on the way down, which is how they were
-- counted before this migration existed.
ALTER TABLE payments DROP COLUMN kind;
DROP TYPE payment_kind;
