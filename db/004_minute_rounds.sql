-- The old deployment may still accept two-minute bets during the rollover.
-- The new deployment explicitly marks its one-minute bets.
ALTER TABLE timed_bets ADD COLUMN IF NOT EXISTS fair_odds boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS players_leaderboard
  ON players (game_net DESC, telegram_id) WHERE telegram_id > 0;
