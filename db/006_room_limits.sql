ALTER TABLE private_rooms
  ADD COLUMN IF NOT EXISTS min_stake bigint NOT NULL DEFAULT 1 CHECK (min_stake >= 1),
  ADD COLUMN IF NOT EXISTS max_stake bigint NOT NULL DEFAULT 9007199254740991
    CHECK (max_stake >= min_stake AND max_stake <= 9007199254740991),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION enforce_private_stake_limits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  room private_rooms%ROWTYPE;
BEGIN
  SELECT * INTO room FROM private_rooms WHERE code = NEW.code FOR SHARE;
  IF NOT FOUND OR room.deleted_at IS NOT NULL OR NEW.stake < room.min_stake OR NEW.stake > room.max_stake THEN
    RAISE EXCEPTION 'Stake outside room limits or room closed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER private_stake_limits BEFORE INSERT OR UPDATE OF stake ON private_bets
  FOR EACH ROW EXECUTE FUNCTION enforce_private_stake_limits();
