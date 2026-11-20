ALTER TABLE timed_bets ADD COLUMN IF NOT EXISTS live_bots boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS private_rooms (
  code text PRIMARY KEY CHECK (code ~ '^[A-F0-9]{10}$'),
  owner_id bigint NOT NULL REFERENCES players (telegram_id),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, request_id)
);

CREATE TABLE IF NOT EXISTS private_members (
  code text NOT NULL REFERENCES private_rooms (code),
  telegram_id bigint NOT NULL REFERENCES players (telegram_id),
  PRIMARY KEY (code, telegram_id)
);

CREATE TABLE IF NOT EXISTS private_rounds (
  code text NOT NULL REFERENCES private_rooms (code),
  number integer NOT NULL CHECK (number > 0),
  result jsonb,
  PRIMARY KEY (code, number)
);

CREATE TABLE IF NOT EXISTS private_bets (
  code text NOT NULL,
  number integer NOT NULL,
  telegram_id bigint NOT NULL,
  stake bigint NOT NULL CHECK (stake > 0),
  request_id uuid NOT NULL,
  PRIMARY KEY (code, number, telegram_id),
  UNIQUE (code, telegram_id, request_id),
  FOREIGN KEY (code, number) REFERENCES private_rounds (code, number),
  FOREIGN KEY (code, telegram_id) REFERENCES private_members (code, telegram_id)
);

CREATE INDEX IF NOT EXISTS private_rounds_due ON private_rounds (number, code) WHERE result IS NULL;
CREATE INDEX IF NOT EXISTS private_bets_by_player ON private_bets (telegram_id, number, code);
CREATE INDEX IF NOT EXISTS private_members_by_player ON private_members (telegram_id, code);
