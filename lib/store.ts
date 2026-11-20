import { createHash, randomBytes, randomInt } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  botRound, DAILY_BONUS, legacyRoundNumber, resolveRound, roundNumber, roundOffer, totalPot,
  type Avatar, type GameState, type Round
} from "./game";
import { GameError, isAdmin, type Player } from "./telegram";
import { LEADERBOARD_PAGE_SIZE, type AdminStats } from "./admin";

type PlayerRow = {
  balance: string;
  game_net: string;
  completed_rounds: number;
  bonus_day: string;
};
type BetRow = {
  round_number: number;
  request_id: string;
  stake: string;
  return_factor: number | null;
  fair_odds: boolean;
};
export type Bet = { stake: number; round: number; requestId: string };

const cache = globalThis as typeof globalThis & { betbookPool?: Pool };
const playerFields = "balance, game_net, completed_rounds, to_char(last_bonus_day, 'YYYY-MM-DD') AS bonus_day";

function randomTicket(pot: number) {
  if (pot < 2 ** 48) return randomInt(pot);
  const bound = BigInt(pot);
  const range = BigInt(1) << BigInt(64);
  const cutoff = range - range % bound;
  let draw = randomBytes(8).readBigUInt64BE();
  while (draw >= cutoff) draw = randomBytes(8).readBigUInt64BE();
  return Number(draw % bound);
}

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

async function transaction<T>(run: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool().connect();
  let discard = false;
  try {
    await db.query("BEGIN");
    const value = await run(db);
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

function withPlayer<T>(player: Player, run: (db: PoolClient, row: PlayerRow, now: number) => Promise<T>) {
  return transaction(async (db) => {
    const result = await db.query<PlayerRow>(
      "INSERT INTO players (telegram_id, display_name, balance, last_bonus_day) " +
      "VALUES ($1, $2, $3, (now() AT TIME ZONE 'Europe/Kyiv')::date) " +
      "ON CONFLICT (telegram_id) DO UPDATE SET display_name = EXCLUDED.display_name, " +
      "balance = players.balance + CASE WHEN players.last_bonus_day < EXCLUDED.last_bonus_day THEN $3 ELSE 0 END, " +
      "last_bonus_day = greatest(players.last_bonus_day, EXCLUDED.last_bonus_day) RETURNING " + playerFields,
      [player.id, player.name, DAILY_BONUS]
    );
    const now = Date.now();
    return run(db, await settleBets(db, player, result.rows[0], now), now);
  });
}

async function settleBets(db: PoolClient, player: Player, row: PlayerRow, now: number) {
  const { rows } = await db.query<BetRow>(
    "SELECT round_number, stake, return_factor, fair_odds FROM timed_bets " +
    "WHERE telegram_id = $1 AND result IS NULL AND round_number < $2 " +
    "AND (fair_odds OR round_number < $3) ORDER BY round_number",
    [player.id, roundNumber(now), legacyRoundNumber(now)]
  );
  for (const bet of rows) {
    const stake = Number(bet.stake);
    const offer = roundOffer(bet.round_number);
    const draw = bet.fair_odds ? randomTicket(totalPot(offer, stake)) : randomInt(1_000_000_000) / 1_000_000_000;
    const result = resolveRound(offer, stake, { ...avatar(player), name: "Ви" }, draw,
      bet.fair_odds ? undefined : bet.return_factor);
    const payout = result.winner === "player" ? result.pot : 0;
    const updated = await db.query<PlayerRow>(
      "UPDATE players SET balance = balance + $2, game_net = game_net + $3, " +
      "completed_rounds = completed_rounds + 1 WHERE telegram_id = $1 RETURNING " + playerFields,
      [player.id, payout, payout - stake]
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
  const current = await db.query<{ stake: string }>(
    "SELECT stake FROM timed_bets WHERE telegram_id = $1 AND round_number = $2 AND fair_odds",
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
      bonusDay: row.bonus_day,
      isAdmin: isAdmin(player)
    },
    offer: roundOffer(number),
    bet: bet ? { stake: Number(bet.stake) } : null,
    feed,
    latest: lastBet?.number === number - 1 ? lastBet : previousBotRound,
    lastBet
  };
}

export function getAdminStats(player: Player, requestedPage: number) {
  return transaction(async (db): Promise<AdminStats> => {
    const now = Date.now();
    const current = roundNumber(now);
    const legacy = legacyRoundNumber(now);
    const due = await db.query<PlayerRow & { telegram_id: string; display_name: string }>(
      "SELECT telegram_id, display_name, " + playerFields + " FROM players WHERE telegram_id IN (" +
      "SELECT telegram_id FROM timed_bets WHERE result IS NULL AND round_number < $1 AND telegram_id > 0 " +
      "AND (fair_odds OR round_number < $2) " +
      "ORDER BY round_number LIMIT 12) ORDER BY telegram_id FOR UPDATE SKIP LOCKED",
      [current, legacy]
    );
    for (const row of due.rows) {
      await settleBets(db, { id: row.telegram_id, name: row.display_name }, row, now);
    }
    const totals = await db.query<{ total: string; played: string; losing: string; net_loss: string; balance: string; pending: boolean }>(
      "SELECT count(*) AS total, count(*) FILTER (WHERE completed_rounds > 0) AS played, " +
      "count(*) FILTER (WHERE game_net < 0) AS losing, coalesce(sum(-game_net) FILTER (WHERE game_net < 0), 0) AS net_loss, " +
      "coalesce(max(balance) FILTER (WHERE telegram_id = $1), 0) AS balance, " +
      "EXISTS (SELECT 1 FROM timed_bets WHERE result IS NULL AND round_number < $2 AND telegram_id > 0 " +
      "AND (fair_odds OR round_number < $3)) AS pending " +
      "FROM players WHERE telegram_id > 0",
      [player.id, current, legacy]
    );
    const { total, played, losing, net_loss, balance, pending } = totals.rows[0];
    const pages = Math.max(1, Math.ceil(Number(total) / LEADERBOARD_PAGE_SIZE));
    const page = Math.min(requestedPage, pages);
    const ranks = await db.query<{ id: string; name: string; rounds: number; game_net: string }>(
      "SELECT telegram_id AS id, display_name AS name, completed_rounds AS rounds, game_net " +
      "FROM players WHERE telegram_id > 0 ORDER BY game_net DESC, telegram_id LIMIT $1 OFFSET $2",
      [LEADERBOARD_PAGE_SIZE, (page - 1) * LEADERBOARD_PAGE_SIZE]
    );
    return {
      played: Number(played), losing: Number(losing), netLoss: Number(net_loss), balance: Number(balance), pending,
      leaderboard: {
        page, pages, total: Number(total),
        players: ranks.rows.map(({ id, name, rounds, game_net }) => ({ id, name, rounds, net: Number(game_net) }))
      }
    };
  });
}

export function addAdminCredits(player: Player, amount: number, requestId: string) {
  return withPlayer(player, async (db, row) => {
    const existing = await db.query<{ amount: string }>(
      "SELECT amount FROM admin_credits WHERE telegram_id = $1 AND request_id = $2", [player.id, requestId]
    );
    if (existing.rows[0]) {
      if (Number(existing.rows[0].amount) !== amount) {
        throw new GameError("Цей запит уже використано для іншої суми.", 409);
      }
      return { balance: Number(row.balance) };
    }
    if (!Number.isSafeInteger(Number(row.balance) + amount)) throw new GameError("Досягнуто ліміту балансу.", 422);
    const updated = await db.query<{ balance: string }>(
      "UPDATE players SET balance = balance + $2 WHERE telegram_id = $1 RETURNING balance", [player.id, amount]
    );
    await db.query(
      "INSERT INTO admin_credits (telegram_id, request_id, amount) VALUES ($1, $2, $3)", [player.id, requestId, amount]
    );
    return { balance: Number(updated.rows[0].balance) };
  });
}

export function welcomeOnce(chatId: number, send: () => Promise<unknown>) {
  return transaction(async (db) => {
    const inserted = await db.query(
      "INSERT INTO bot_welcomes (chat_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING chat_id", [chatId]
    );
    if (inserted.rowCount) await send();
  });
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
    if (!Number.isSafeInteger(Number(row.balance) + totalPot(roundOffer(bet.round), 0))) {
      throw new GameError("Досягнуто ліміту балансу.", 422);
    }
    const updated = await db.query<PlayerRow>(
      "UPDATE players SET balance = balance - $2 WHERE telegram_id = $1 RETURNING " + playerFields,
      [player.id, bet.stake]
    );
    await db.query(
      "INSERT INTO timed_bets (telegram_id, round_number, request_id, stake, fair_odds) VALUES ($1, $2, $3, $4, true)",
      [player.id, bet.round, bet.requestId, bet.stake]
    );
    return readState(db, player, updated.rows[0], now);
  });
}
