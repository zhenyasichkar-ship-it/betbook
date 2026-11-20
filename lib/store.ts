import { randomInt } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { DAILY_BONUS, resolveRound, roundOffer, type BotId, type GameState, type Round } from "./game";
import { GameError, type Player } from "./telegram";

type PlayerRow = {
  balance: string;
  game_net: string;
  completed_rounds: number;
  bonus_day: string;
};

export type Bet = { stake: number; round: number; requestId: string };

const cache = globalThis as typeof globalThis & { betbookPool?: Pool };

function pool() {
  if (!process.env.DATABASE_URL) {
    throw new GameError("База Betbook ещё не настроена.", 503);
  }
  if (!cache.betbookPool) {
    const db = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true
    });
    db.on("error", () => console.error("Betbook: idle database connection closed"));
    cache.betbookPool = db;
  }
  return cache.betbookPool;
}

async function withPlayer<T>(
  player: Player,
  run: (db: PoolClient, row: PlayerRow) => Promise<T>
): Promise<T> {
  const db = await pool().connect();
  let discard = false;
  try {
    await db.query("BEGIN");
    const result = await db.query<PlayerRow>([
      "INSERT INTO players (telegram_id, display_name, balance, last_bonus_day)",
      "VALUES ($1, $2, $3, (now() AT TIME ZONE 'Europe/Kyiv')::date)",
      "ON CONFLICT (telegram_id) DO UPDATE",
      "SET display_name = EXCLUDED.display_name,",
      "    balance = players.balance +",
      "      CASE WHEN players.last_bonus_day < EXCLUDED.last_bonus_day THEN $3 ELSE 0 END,",
      "    last_bonus_day = greatest(players.last_bonus_day, EXCLUDED.last_bonus_day)",
      "RETURNING balance, game_net, completed_rounds, to_char(last_bonus_day, 'YYYY-MM-DD') AS bonus_day"
    ].join("\n"), [player.id, player.name, DAILY_BONUS]);
    const value = await run(db, result.rows[0]);
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

async function readState(db: PoolClient, player: Player, row: PlayerRow, latest: Round | null): Promise<GameState> {
  const { rows } = await db.query<{ winner: BotId; pot: string }>([
    "SELECT winner, pot FROM (",
    "  SELECT winner, pot, played_at",
    "  FROM rounds WHERE winner <> 'player'",
    "  ORDER BY played_at DESC LIMIT 50",
    ") AS recent",
    "ORDER BY pot DESC, played_at DESC LIMIT 3"
  ].join("\n"));
  const net = Number(row.game_net);
  return {
    profile: {
      name: player.name,
      balance: Number(row.balance),
      rounds: row.completed_rounds,
      net,
      netLoss: Math.max(0, -net),
      bonusDay: row.bonus_day
    },
    offer: roundOffer(row.completed_rounds + 1),
    feed: rows.map(({ winner, pot }) => ({ bot: winner, pot: Number(pot) })),
    latest
  };
}

export function openGame(player: Player) {
  return withPlayer(player, async (db, row) => {
    const previous = await db.query<{ result: Round }>(
      "SELECT result FROM rounds WHERE telegram_id = $1 AND number = $2",
      [player.id, row.completed_rounds]
    );
    return readState(db, player, row, previous.rows[0]?.result ?? null);
  });
}

export function placeBet(player: Player, bet: Bet) {
  return withPlayer(player, async (db, row) => {
    const saved = await db.query<{ result: Round }>(
      "SELECT result FROM rounds WHERE telegram_id = $1 AND request_id = $2",
      [player.id, bet.requestId]
    );
    const existing = saved.rows[0]?.result;
    if (existing) {
      if (existing.number !== bet.round || existing.stake !== bet.stake) {
        throw new GameError("Этот запрос уже использован для другой ставки.", 409);
      }
      return readState(db, player, row, existing);
    }
    if (bet.round !== row.completed_rounds + 1) {
      throw new GameError("Раунд уже изменился. Обновите игру и проверьте баланс.", 409);
    }
    if (bet.stake > Number(row.balance)) {
      throw new GameError("На виртуальном балансе не хватает средств.", 422);
    }
    const result = resolveRound(roundOffer(bet.round), bet.stake, randomInt(1_000_000_000) / 1_000_000_000);
    const net = (result.winner === "player" ? result.pot : 0) - bet.stake;
    const updated = await db.query<PlayerRow>([
      "UPDATE players SET balance = balance + $2, game_net = game_net + $2, completed_rounds = $3",
      "WHERE telegram_id = $1",
      "RETURNING balance, game_net, completed_rounds, to_char(last_bonus_day, 'YYYY-MM-DD') AS bonus_day"
    ].join("\n"), [player.id, net, bet.round]);
    await db.query(
      "INSERT INTO rounds (telegram_id, number, request_id, winner, pot, result) VALUES ($1, $2, $3, $4, $5, $6)",
      [player.id, bet.round, bet.requestId, result.winner, result.pot, result]
    );
    return readState(db, player, updated.rows[0], result);
  });
}
