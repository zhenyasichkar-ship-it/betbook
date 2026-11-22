-- Pending bets and rounds keep the payout rules they were created with.
ALTER TABLE timed_bets ADD COLUMN IF NOT EXISTS house_fee_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE private_rounds ADD COLUMN IF NOT EXISTS house_fee_enabled boolean NOT NULL DEFAULT false;
