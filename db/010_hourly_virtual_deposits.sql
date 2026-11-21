ALTER TABLE players ADD COLUMN IF NOT EXISTS welcome_granted_at timestamptz;

CREATE TABLE IF NOT EXISTS hourly_virtual_deposits (
  telegram_id bigint NOT NULL REFERENCES players (telegram_id),
  request_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL,
  amount smallint NOT NULL CHECK (amount BETWEEN 0 AND 100),
  PRIMARY KEY (telegram_id, request_id)
);

CREATE INDEX IF NOT EXISTS hourly_deposits_latest ON hourly_virtual_deposits (telegram_id, claimed_at DESC);
