-- Rolling back puts rejected proofs back in the pending queue rather than
-- deleting them: the down migration must not destroy what the up kept.
ALTER TABLE payments
    DROP CONSTRAINT payments_rejected_not_approved,
    DROP COLUMN rejection_reason,
    DROP COLUMN rejected_at;
