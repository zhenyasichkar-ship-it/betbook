ALTER TABLE timed_bets
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS placed_ms bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'timed_bets'::regclass AND conname = 'timed_bets_mode_pkey'
  ) THEN
    ALTER TABLE timed_bets
      DROP CONSTRAINT timed_bets_pkey,
      ADD CONSTRAINT timed_bets_mode_pkey PRIMARY KEY (telegram_id, round_number, mode),
      ADD CONSTRAINT timed_bets_mode_limits CHECK (
        mode = 'legacy' OR (
          placed_ms IS NOT NULL AND
          (placed_ms / 60000) = round_number AND
          (result IS NULL OR (result ->> 'mode') IS NOT DISTINCT FROM mode) AND
          ((mode = 'low' AND stake BETWEEN 1 AND 50)
            OR (mode = 'medium' AND stake BETWEEN 10 AND 200)
            OR (mode = 'high' AND stake BETWEEN 50 AND 500))
        )
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS timed_bets_mode_wins ON timed_bets (mode, round_number DESC)
  WHERE winner <> 'player';
