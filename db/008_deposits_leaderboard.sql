CREATE TABLE IF NOT EXISTS virtual_deposits (
  telegram_id bigint NOT NULL REFERENCES players (telegram_id),
  request_id uuid NOT NULL,
  deposit_day date NOT NULL,
  amount smallint NOT NULL CHECK (amount BETWEEN 1 AND 100),
  PRIMARY KEY (telegram_id, request_id)
);

CREATE INDEX IF NOT EXISTS virtual_deposits_by_day ON virtual_deposits (telegram_id, deposit_day);

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS season_start_net bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS season_start_rounds integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS leaderboard_resets (
  name text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS players_season_leaderboard
  ON players ((game_net - season_start_net) DESC, telegram_id)
  WHERE telegram_id > 0 AND completed_rounds > season_start_rounds;
