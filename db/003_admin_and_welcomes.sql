CREATE TABLE IF NOT EXISTS admin_credits (
  telegram_id bigint NOT NULL REFERENCES players (telegram_id),
  request_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, request_id)
);

CREATE TABLE IF NOT EXISTS bot_welcomes (
  chat_id bigint PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS timed_bets_due
  ON timed_bets (round_number) INCLUDE (telegram_id) WHERE result IS NULL;
