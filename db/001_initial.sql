CREATE TABLE IF NOT EXISTS players (
  telegram_id bigint PRIMARY KEY,
  display_name text NOT NULL,
  balance bigint NOT NULL CHECK (balance >= 0),
  last_bonus_day date NOT NULL,
  completed_rounds integer NOT NULL DEFAULT 0 CHECK (completed_rounds >= 0),
  game_net bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rounds (
  telegram_id bigint NOT NULL REFERENCES players (telegram_id),
  number integer NOT NULL CHECK (number > 0),
  request_id uuid NOT NULL,
  winner text NOT NULL CHECK (winner IN ('player', 'nova', 'mako', 'rio')),
  pot bigint NOT NULL CHECK (pot > 0),
  result jsonb NOT NULL,
  played_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, number),
  UNIQUE (telegram_id, request_id)
);

CREATE INDEX IF NOT EXISTS rounds_bot_recent
  ON rounds (played_at DESC) INCLUDE (winner, pot)
  WHERE winner <> 'player';
