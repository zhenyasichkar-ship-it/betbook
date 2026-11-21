import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { ROUND_MS, roundNumber, type Participant } from "./game";
import { ROOM_LIMIT, type RoomLimits, type RoomResult, type RoomState, type RoomSummary } from "./room-types";
import { avatar, randomTicket, touchPlayer, transaction, type Bet } from "./store";
import { GameError, type Player } from "./telegram";

const colors = ["#ff75b9", "#56e8d7", "#ffae72", "#a78af8", "#63afff", "#ef8aeb", "#c8e668", "#f77a77", "#8be5ff", "#f8d589", "#b0f38c", "#a49aff"];
const missingRoom = "Кімнату не знайдено або немає доступу.";
type Seat = { telegram_id: string; display_name: string; stake: string };
type RoomSettings = { owner_id: string; min_stake: string; max_stake: string; deleted_at: Date | null };

function memberId(code: string, id: string) {
  return createHash("sha256").update(code + ":" + id).digest("hex").slice(0, 24);
}

async function lockRoom(db: PoolClient, code: string, includeDeleted = false) {
  const { rows } = await db.query<RoomSettings>(
    "SELECT owner_id, min_stake, max_stake, deleted_at FROM private_rooms WHERE code = $1 FOR UPDATE", [code]
  );
  const room = rows[0];
  if (!room || (room.deleted_at && !includeDeleted)) throw new GameError(missingRoom, 404);
  return room;
}

async function hasMember(db: PoolClient, code: string, id: string) {
  return !!(await db.query("SELECT 1 FROM private_members WHERE code = $1 AND telegram_id = $2", [code, id])).rowCount;
}

function entries(code: string, rows: Seat[]) {
  const pot = rows.reduce((sum, row) => sum + Number(row.stake), 0);
  const participants = rows.map((row, index): Participant => {
    const stake = Number(row.stake);
    return { ...avatar({ id: row.telegram_id, name: row.display_name }), id: memberId(code, row.telegram_id),
      color: colors[index], stake, share: stake / pot, chance: stake / pot };
  });
  return { pot, participants };
}

async function readSeats(db: PoolClient, code: string, number: number) {
  const { rows } = await db.query<Seat>(
    "SELECT p.telegram_id, p.display_name, b.stake FROM private_bets b JOIN players p USING (telegram_id) " +
    "WHERE b.code = $1 AND b.number = $2 ORDER BY p.telegram_id",
    [code, number]
  );
  return rows;
}

async function settleRoom(db: PoolClient, code: string, current: number) {
  const { rows } = await db.query<{ number: number }>(
    "SELECT number FROM private_rounds WHERE code = $1 AND number < $2 AND result IS NULL ORDER BY number", [code, current]
  );
  if (!rows.length) return;
  await db.query(
    "SELECT telegram_id FROM players WHERE telegram_id IN (" +
    "SELECT telegram_id FROM private_bets WHERE code = $1 AND number = ANY($2::integer[])) " +
    "ORDER BY telegram_id FOR UPDATE",
    [code, rows.map((row) => row.number)]
  );
  const season = await db.query<{ epoch: number }>(
    "SELECT extract(epoch FROM started_at)::double precision AS epoch FROM leaderboard_resets WHERE name = 'manual-deposits'"
  );
  for (const { number } of rows) {
    const beforeSeason = !!season.rows[0] && (number + 1) * 60 <= season.rows[0].epoch;
    const seats = await readSeats(db, code, number);
    const { participants, pot } = entries(code, seats);
    let winner: string | null = null;
    if (participants.length >= 2) {
      let ticket = randomTicket(pot);
      for (const entry of participants) {
        ticket -= entry.stake;
        if (ticket < 0) {
          winner = entry.id;
          break;
        }
      }
    }
    for (const [index, seat] of seats.entries()) {
      const stake = Number(seat.stake);
      const payout = winner ? (participants[index].id === winner ? pot : 0) : stake;
      await db.query(
        "UPDATE players SET balance = balance + $2, game_net = game_net + $3, completed_rounds = completed_rounds + $4, " +
        "season_start_net = season_start_net + CASE WHEN $5 THEN $3 ELSE 0 END, " +
        "season_start_rounds = season_start_rounds + CASE WHEN $5 THEN $4 ELSE 0 END " +
        "WHERE telegram_id = $1", [seat.telegram_id, payout, payout - stake, winner ? 1 : 0, beforeSeason]
      );
    }
    const result: RoomResult = { number, pot, participants, winner };
    await db.query("UPDATE private_rounds SET result = $3 WHERE code = $1 AND number = $2", [code, number, result]);
  }
}

async function readRoom(db: PoolClient, code: string, player: Player, now: number, settings: RoomSettings): Promise<RoomState> {
  const number = roundNumber(now);
  const seats = await readSeats(db, code, number);
  const { pot, participants } = entries(code, seats);
  const { rows } = await db.query<{ balance: string; members: string; latest: RoomResult | null }>(
    "SELECT balance, (SELECT count(*) FROM private_members WHERE code = $2) AS members, " +
    "(SELECT result FROM private_rounds WHERE code = $2 AND result IS NOT NULL ORDER BY number DESC LIMIT 1) AS latest " +
    "FROM players WHERE telegram_id = $1", [player.id, code]
  );
  return {
    code, now, number, endsAt: (number + 1) * ROUND_MS, participants, pot,
    minStake: Number(settings.min_stake), maxStake: Number(settings.max_stake), canDelete: settings.owner_id === player.id,
    selfId: memberId(code, player.id),
    stake: Number(seats.find((seat) => seat.telegram_id === player.id)?.stake ?? 0),
    balance: Number(rows[0].balance), members: Number(rows[0].members), latest: rows[0].latest
  };
}

export function listRooms(player: Player) {
  return transaction(async (db): Promise<{ rooms: RoomSummary[] }> => {
    const { rows } = await db.query<{ code: string; members: string }>(
      "SELECT r.code, (SELECT count(*) FROM private_members m WHERE m.code = r.code) AS members " +
      "FROM private_members mine JOIN private_rooms r USING (code) WHERE mine.telegram_id = $1 AND r.deleted_at IS NULL " +
      "ORDER BY r.created_at DESC, r.code", [player.id]
    );
    return { rooms: rows.map(({ code, members }) => ({ code, members: Number(members) })) };
  });
}

export function createRoom(player: Player, requestId: string, limits: RoomLimits) {
  return transaction(async (db) => {
    await touchPlayer(db, player);
    const existing = await db.query<RoomSettings & { code: string }>(
      "SELECT code, min_stake, max_stake, deleted_at FROM private_rooms WHERE owner_id = $1 AND request_id = $2", [player.id, requestId]
    );
    const previous = existing.rows[0];
    if (previous) {
      if (previous.deleted_at || Number(previous.min_stake) !== limits.minStake || Number(previous.max_stake) !== limits.maxStake) {
        throw new GameError("Цей запит на створення кімнати вже використано.", 409);
      }
      return { code: previous.code };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomBytes(5).toString("hex").toUpperCase();
      const inserted = await db.query(
        "INSERT INTO private_rooms (code, owner_id, request_id, min_stake, max_stake) " +
        "VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING RETURNING code",
        [code, player.id, requestId, limits.minStake, limits.maxStake]
      );
      if (!inserted.rowCount) continue;
      await db.query("INSERT INTO private_members (code, telegram_id) VALUES ($1,$2)", [code, player.id]);
      return { code };
    }
    throw new GameError("Не вдалося створити кімнату. Спробуйте ще раз.", 503);
  });
}

function withRoom<T>(code: string, player: Player, run: (db: PoolClient, now: number, settings: RoomSettings) => Promise<T>) {
  return transaction(async (db) => {
    const settings = await lockRoom(db, code);
    if (!(await hasMember(db, code, player.id))) throw new GameError(missingRoom, 404);
    const now = Date.now();
    await settleRoom(db, code, roundNumber(now));
    return run(db, now, settings);
  });
}

export function joinRoom(code: string, player: Player) {
  return transaction(async (db) => {
    await lockRoom(db, code);
    if (!(await hasMember(db, code, player.id))) {
      const { rows } = await db.query<{ count: string }>("SELECT count(*) FROM private_members WHERE code = $1", [code]);
      if (Number(rows[0].count) >= ROOM_LIMIT) throw new GameError("У цій кімнаті вже 12 учасників.", 409);
      await touchPlayer(db, player);
      await db.query("INSERT INTO private_members (code, telegram_id) VALUES ($1,$2)", [code, player.id]);
    }
    return { code };
  });
}

export function openRoom(code: string, player: Player) {
  return withRoom(code, player, (db, now, settings) => readRoom(db, code, player, now, settings));
}

export function betInRoom(code: string, player: Player, bet: Bet) {
  return withRoom(code, player, async (db, _now, settings) => {
    if (bet.stake < Number(settings.min_stake) || bet.stake > Number(settings.max_stake)) {
      throw new GameError("Ставка виходить за межі лімітів кімнати.", 422);
    }
    const saved = await db.query<{ number: number; stake: string }>(
      "SELECT number, stake FROM private_bets WHERE code = $1 AND telegram_id = $2 AND request_id = $3",
      [code, player.id, bet.requestId]
    );
    if (saved.rows[0]) {
      if (saved.rows[0].number !== bet.round || Number(saved.rows[0].stake) !== bet.stake) {
        throw new GameError("Цей запит уже використано для іншої ставки.", 409);
      }
      return readRoom(db, code, player, Date.now(), settings);
    }
    const wallet = await touchPlayer(db, player);
    const now = Date.now();
    if (bet.round !== roundNumber(now)) throw new GameError("Раунд завершився. Зробіть ставку в наступному.", 409);
    const seats = await readSeats(db, code, bet.round);
    if (seats.some((seat) => seat.telegram_id === player.id)) throw new GameError("Ви вже зробили ставку в цьому раунді.", 409);
    if (bet.stake > Number(wallet.balance)) throw new GameError("Недостатньо віртуальних коштів.", 422);
    if (!Number.isSafeInteger(seats.reduce((pot, seat) => pot + Number(seat.stake), bet.stake))) {
      throw new GameError("Досягнуто ліміту банку.", 422);
    }
    await db.query("INSERT INTO private_rounds (code, number) VALUES ($1,$2) ON CONFLICT DO NOTHING", [code, bet.round]);
    await db.query("UPDATE players SET balance = balance - $2 WHERE telegram_id = $1", [player.id, bet.stake]);
    await db.query("INSERT INTO private_bets (code, number, telegram_id, stake, request_id) VALUES ($1,$2,$3,$4,$5)",
      [code, bet.round, player.id, bet.stake, bet.requestId]);
    return readRoom(db, code, player, now, settings);
  });
}

export function deleteRoom(code: string, player: Player) {
  return transaction(async (db) => {
    const room = await lockRoom(db, code, true);
    if (room.owner_id !== player.id) throw new GameError("Видалити кімнату може лише її власник.", 403);
    if (room.deleted_at) return { deleted: true };
    const current = roundNumber(Date.now());
    await db.query(
      "SELECT telegram_id FROM players WHERE telegram_id IN (" +
      "SELECT b.telegram_id FROM private_bets b JOIN private_rounds r USING (code, number) " +
      "WHERE r.code = $1 AND r.result IS NULL) ORDER BY telegram_id FOR UPDATE", [code]
    );
    await settleRoom(db, code, current);
    await db.query(
      "UPDATE players p SET balance = p.balance + refunds.total FROM (" +
      "SELECT b.telegram_id, sum(b.stake)::bigint AS total FROM private_bets b JOIN private_rounds r USING (code, number) " +
      "WHERE r.code = $1 AND r.result IS NULL GROUP BY b.telegram_id" +
      ") refunds WHERE p.telegram_id = refunds.telegram_id", [code]
    );
    await db.query(
      "UPDATE private_rounds SET result = jsonb_build_object('number', number, 'pot', 0, 'winner', NULL::text, 'participants', '[]'::jsonb) " +
      "WHERE code = $1 AND result IS NULL", [code]
    );
    await db.query("UPDATE private_rooms SET deleted_at = now() WHERE code = $1", [code]);
    return { deleted: true };
  });
}

export async function settleExpiredRooms(playerId?: string) {
  const current = roundNumber(Date.now());
  const rows = await transaction(async (db) => {
    const result = await db.query<{ code: string }>(
      "SELECT DISTINCT r.code FROM private_rounds r WHERE r.number < $1 AND r.result IS NULL " +
      (playerId ? "AND EXISTS (SELECT 1 FROM private_bets b WHERE b.code = r.code AND b.number = r.number AND b.telegram_id = $2) " : "") +
      "ORDER BY r.code LIMIT 8", playerId ? [current, playerId] : [current]
    );
    return result.rows;
  });
  for (const { code } of rows) {
    await transaction(async (db) => {
      const room = await lockRoom(db, code, true);
      if (!room.deleted_at) await settleRoom(db, code, current);
    });
  }
  return rows.length === 8;
}
