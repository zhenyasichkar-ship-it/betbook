import { createHash, randomInt } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  botRound, DAILY_BONUS, getReturnFactor, resolveRound, roundNumber, roundOffer,
  type Avatar, type GameState, type Round
} from "./game";
import { GameError, type Player } from "./telegram";

type PlayerRow = {
  balance: string;
  game_net: string;
  completed_rounds: number;
  loss_streak: number;
  bonus_day: string;
};
type BetRow = {
  round_number: number;
  request_id: string;
  stake: string;
  return_factor: number | null;
};
export type Bet = { stake: number; round: number; requestId: string };

const cache = globalThis as typeof globalThis & { betbookPool?: Pool };
const playerFields = "balance, game_net, completed_rounds, loss_streak, to_char(last_bonus_day, 'YYYY-MM-DD') AS bonus_day";

function pool() {
  if (!process.env.DATABASE_URL) throw new GameError("Базу Betbook ще не налаштовано.", 503);
  if (!cache.betbookPool) {
    const db = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true
    });
    db.on("error", () => console.error("Betbook: закрито неактивне з’єднання з базою"));
    cache.betbookPool = db;
  }
  return cache.betbookPool;
}

function avatar(player: Player): Avatar {
  const seed = createHash("sha256").update("betbook-avatar:" + player.id).digest().readUInt32BE();
  return { name: player.name, color: "#ff75b9", avatar: seed };
}

async function withPlayer<T>(
  player: Player,
  run: (db: PoolClient, row: PlayerRow, now: number) => Promise<T>
): Promise<T> {
  const db = await pool().connect();
  let discard = false;
  try {
    await db.query("BEGIN");
    const result = await db.query<PlayerRow>(
      "INSERT INTO players (telegram_id, display_name, balance, last_bonus_day) " +
      "VALUES ($1, $2, $3, (now() AT TIME ZONE 'Europe/Kyiv')::date) " +
      "ON CONFLICT (telegram_id) DO UPDATE SET display_name = EXCLUDED.display_name, " +
      "balance = players.balance + CASE WHEN players.last_bonus_day < EXCLUDED.last_bonus_day THEN $3 ELSE 0 END, " +
      "last_bonus_day = greatest(players.last_bonus_day, EXCLUDED.last_bonus_day) RETURNING " + playerFields,
      [player.id, player.name, DAILY_BONUS]
    );
    const now = Date.now();
    const settled = await settleBets(db, player, result.rows[0], roundNumber(now));
    const value = await run(db, settled, now);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    db.release(discard);
  }
}

async function settleBets(db: PoolClient, player: Player, row: PlayerRow, current: number) {
  const { rows } = await db.query<BetRow>(
    "SELECT round_number, stake, return_factor FROM timed_bets " +
    "WHERE telegram_id = $1 AND result IS NULL AND round_number < $2 ORDER BY round_number",
    [player.id, current]
  );
  for (const bet of rows) {
    const stake = Number(bet.stake);
    const offer = roundOffer(bet.round_number, bet.return_factor);
    const result = resolveRound(offer, stake, { ...avatar(player), name: "Ви" },
      randomInt(1_000_000_000) / 1_000_000_000);
    const payout = result.winner === "player" ? result.pot : 0;
    const updated = await db.query<PlayerRow>(
      "UPDATE players SET balance = balance + $2, game_net = game_net + $3, " +
      "completed_rounds = completed_rounds + 1, loss_streak = $4 WHERE telegram_id = $1 RETURNING " + playerFields,
      [player.id, payout, payout - stake, payout ? 0 : row.loss_streak + 1]
    );
    await db.query(
      "UPDATE timed_bets SET result = $3, winner = $4, pot = $5 WHERE telegram_id = $1 AND round_number = $2",
      [player.id, result.number, result, result.winner, result.pot]
    );
    row = updated.rows[0];
  }
  return row;
}

function winCard(result: Round, key: string) {
  const winner = result.participants.find((entry) => entry.id === result.winner)!;
  return { name: winner.name, avatar: winner.avatar, color: winner.color, round: result.number, pot: result.pot, key };
}

async function readState(db: PoolClient, player: Player, row: PlayerRow, now: number): Promise<GameState> {
  const number = roundNumber(now);
  const current = await db.query<{ stake: string; return_factor: number | null }>(
    "SELECT stake, return_factor FROM timed_bets WHERE telegram_id = $1 AND round_number = $2",
    [player.id, number]
  );
  const previous = await db.query<{ result: Round }>(
    "SELECT result FROM timed_bets WHERE telegram_id = $1 AND round_number < $2 AND result IS NOT NULL " +
    "ORDER BY round_number DESC LIMIT 1",
    [player.id, number]
  );
  const wins = await db.query<{ result: Round; key: string }>(
    "SELECT result, request_id AS key FROM timed_bets WHERE winner <> 'player' " +
    "AND round_number BETWEEN $1 AND $2 ORDER BY round_number DESC, pot DESC, request_id LIMIT 5",
    [number - 6, number - 1]
  );
  const bet = current.rows[0];
  const lastBet = previous.rows[0]?.result ?? null;
  const previousBotRound = botRound(number - 1);
  const recentBots = [previousBotRound, ...[2, 3, 4, 5, 6].map((offset) => botRound(number - offset))];
  const feed = [
    ...recentBots.map((result) => winCard(result, "bots-" + result.number)),
    ...wins.rows.map(({ result, key }) => winCard(result, key))
  ].sort((a, b) => b.round - a.round || b.pot - a.pot).slice(0, 8);
  return {
    now,
    profile: {
      ...avatar(player),
      balance: Number(row.balance),
      rounds: row.completed_rounds,
      netLoss: Math.max(0, -Number(row.game_net)),
      bonusDay: row.bonus_day
    },
    offer: roundOffer(number, bet ? bet.return_factor : getReturnFactor(number, row.completed_rounds, row.loss_streak)),
    bet: bet ? { stake: Number(bet.stake) } : null,
    feed,
    latest: lastBet?.number === number - 1 ? lastBet : previousBotRound,
    lastBet
  };
}

export function openGame(player: Player) {
  return withPlayer(player, (db, row, now) => readState(db, player, row, now));
}

export function placeBet(player: Player, bet: Bet) {
  return withPlayer(player, async (db, row, now) => {
    const saved = await db.query<BetRow>(
      "SELECT round_number, stake FROM timed_bets WHERE telegram_id = $1 AND request_id = $2",
      [player.id, bet.requestId]
    );
    if (saved.rows[0]) {
      if (saved.rows[0].round_number !== bet.round || Number(saved.rows[0].stake) !== bet.stake) {
        throw new GameError("Цей запит уже використано для іншої ставки.", 409);
      }
      return readState(db, player, row, now);
    }
    if (bet.round !== roundNumber(now)) {
      throw new GameError("Раунд завершився. Перевірте ставку для нового раунду.", 409);
    }
    const current = await db.query(
      "SELECT 1 FROM timed_bets WHERE telegram_id = $1 AND round_number = $2",
      [player.id, bet.round]
    );
    if (current.rowCount) throw new GameError("Ви вже зробили ставку в цьому раунді.", 409);
    if (bet.stake > Number(row.balance)) throw new GameError("Недостатньо віртуальних коштів.", 422);
    const updated = await db.query<PlayerRow>(
      "UPDATE players SET balance = balance - $2 WHERE telegram_id = $1 RETURNING " + playerFields,
      [player.id, bet.stake]
    );
    await db.query(
      "INSERT INTO timed_bets (telegram_id, round_number, request_id, stake, return_factor) VALUES ($1, $2, $3, $4, $5)",
      [player.id, bet.round, bet.requestId, bet.stake, getReturnFactor(bet.round, row.completed_rounds, row.loss_streak)]
    );
    return readState(db, player, updated.rows[0], now);
  });
}
