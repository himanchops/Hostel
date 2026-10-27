-- The owner's UPI ID, for the WhatsApp reminder.
--
-- Rent arrives by UPI QR at reception or in cash, and a reminder that says
-- "please pay" without saying where meant a second message every time
-- (owner, Oct 2026). Set once on the Account page; the reminder adds "You
-- can pay by UPI to …" when there is one. Nullable: owners who have not set
-- it get the reminder without that line, as before.
ALTER TABLE owners ADD COLUMN upi_id TEXT;
