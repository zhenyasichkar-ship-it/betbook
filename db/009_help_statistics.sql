CREATE TABLE IF NOT EXISTS help_statistics_reset (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
