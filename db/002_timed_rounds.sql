ALTER TABLE players ADD COLUMN IF NOT EXISTS loss_streak integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS timed_bets (
  telegram_id bigint NOT NULL REFERENCES players (telegram_id),
  round_number integer NOT NULL CHECK (round_number > 0),
  request_id uuid NOT NULL,
  stake bigint NOT NULL CHECK (stake > 0),
  return_factor double precision CHECK (return_factor > 0 AND return_factor < 1),
  result jsonb,
  winner text,
  pot bigint,
  PRIMARY KEY (telegram_id, round_number),
  UNIQUE (telegram_id, request_id)
);

CREATE INDEX IF NOT EXISTS timed_bets_pending
  ON timed_bets (telegram_id, round_number) WHERE result IS NULL;

CREATE INDEX IF NOT EXISTS timed_bets_recent_bot_wins
  ON timed_bets (round_number DESC) WHERE winner <> 'player';
