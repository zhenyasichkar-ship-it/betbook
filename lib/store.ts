import { createHash, randomBytes, randomInt } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  botRound, DAILY_BONUS, legacyRoundNumber, liveOffer, resolveRound, ROULETTE_MODES, roundNumber, roundOffer, totalPot,
  type Avatar, type GameState, type Round, type RouletteMode
} from "./game";
import { GameError, isAdmin, type Player } from "./telegram";
import { LEADERBOARD_PAGE_SIZE, type AdminStats } from "./admin";
import { DEPOSIT_COOLDOWN_MS, MAX_DEPOSIT, type DepositClaim, type DepositState, type PublicStats } from "./deposits";

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
  live_bots: boolean;
  mode: RouletteMode | "legacy";
  placed_ms: string | null;
  before_season: boolean | null;
};
export type Bet = { stake: number; round: number; requestId: string };
export type ModeBet = Bet & { mode: RouletteMode };

const cache = globalThis as typeof globalThis & { betbookPool?: Pool };
const playerFields = "balance, game_net, completed_rounds, to_char(last_bonus_day, 'YYYY-MM-DD') AS bonus_day";

export function randomTicket(pot: number) {
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

export function avatar(player: Player): Avatar {
  const seed = createHash("sha256").update("betbook-avatar:" + player.id).digest().readUInt32BE();
  return { name: player.name, color: "#ff75b9", avatar: seed };
}

export async function transaction<T>(run: (db: PoolClient) => Promise<T>): Promise<T> {
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

export async function touchPlayer(db: PoolClient, player: Player) {
  const result = await db.query<PlayerRow>(
      "INSERT INTO players (telegram_id, display_name, balance, last_bonus_day, welcome_granted_at) " +
      "VALUES ($1, $2, $3, (now() AT TIME ZONE 'Europe/Kyiv')::date, clock_timestamp()) " +
      "ON CONFLICT (telegram_id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING " + playerFields,
    [player.id, player.name, DAILY_BONUS]
  );
  return result.rows[0];
}

function withPlayer<T>(player: Player, run: (db: PoolClient, row: PlayerRow, now: number) => Promise<T>) {
  return transaction(async (db) => {
    const row = await touchPlayer(db, player);
    const now = Date.now();
    return run(db, await settleBets(db, player, row, now), now);
  });
}

async function settleBets(db: PoolClient, player: Player, row: PlayerRow, now: number) {
  const { rows } = await db.query<BetRow>(
    "SELECT round_number, stake, return_factor, fair_odds, live_bots, mode, placed_ms, " +
    "to_timestamp((round_number + 1)::double precision * CASE WHEN fair_odds THEN 60 ELSE 120 END) <= " +
    "(SELECT started_at FROM leaderboard_resets WHERE name = 'manual-deposits') AS before_season FROM timed_bets " +
    "WHERE telegram_id = $1 AND result IS NULL AND round_number < $2 " +
    "AND (fair_odds OR round_number < $3) ORDER BY round_number, mode",
    [player.id, roundNumber(now), legacyRoundNumber(now)]
  );
  for (const bet of rows) {
    const stake = Number(bet.stake);
    const base = roundOffer(bet.round_number, bet.live_bots, bet.mode);
    const offer = liveOffer(base, stake, base.endsAt, bet.placed_ms === null ? Infinity : Number(bet.placed_ms));
    const draw = bet.fair_odds ? randomTicket(totalPot(offer, stake)) : randomInt(1_000_000_000) / 1_000_000_000;
    const result = resolveRound(offer, stake, { ...avatar(player), name: "Ви" }, draw,
      bet.fair_odds ? undefined : bet.return_factor);
    const payout = result.winner === "player" ? result.pot : 0;
    const updated = await db.query<PlayerRow>(
      "UPDATE players SET balance = balance + $2, game_net = game_net + $3, " +
      "completed_rounds = completed_rounds + 1, " +
      "season_start_net = season_start_net + CASE WHEN $4 THEN $3 ELSE 0 END, " +
      "season_start_rounds = season_start_rounds + CASE WHEN $4 THEN 1 ELSE 0 END " +
      "WHERE telegram_id = $1 RETURNING " + playerFields,
      [player.id, payout, payout - stake, bet.before_season]
    );
    await db.query(
      "UPDATE timed_bets SET result = $3, winner = $4, pot = $5 WHERE telegram_id = $1 AND round_number = $2 AND mode = $6",
      [player.id, result.number, result, result.winner, result.pot, bet.mode]
    );
    row = updated.rows[0];
  }
  return row;
}

function winCard(result: Round, key: string) {
  const winner = result.participants.find((entry) => entry.id === result.winner)!;
  return { name: winner.name, avatar: winner.avatar, color: winner.color, round: result.number, pot: result.pot, key };
}

async function readState(db: PoolClient, player: Player, row: PlayerRow, now: number, mode: RouletteMode): Promise<GameState> {
  const number = roundNumber(now);
  const current = await db.query<{ stake: string; placed_ms: string }>(
    "SELECT stake, placed_ms FROM timed_bets WHERE telegram_id = $1 AND round_number = $2 AND mode = $3",
    [player.id, number, mode]
  );
  const previous = await db.query<{ last_bet: Round | null; mode_bet: Round | null }>(
    "SELECT (SELECT result FROM timed_bets WHERE telegram_id = $1 AND round_number < $2 AND result IS NOT NULL " +
    "ORDER BY round_number DESC, placed_ms DESC NULLS LAST LIMIT 1) AS last_bet, " +
    "(SELECT result FROM timed_bets WHERE telegram_id = $1 AND round_number = $2 - 1 AND mode = $3) AS mode_bet",
    [player.id, number, mode]
  );
  const wins = await db.query<{ result: Round; key: string }>(
    "SELECT result, request_id AS key FROM timed_bets WHERE winner <> 'player' AND mode = $3 " +
    "AND round_number BETWEEN $1 AND $2 ORDER BY round_number DESC, pot DESC, request_id LIMIT 5",
    [number - 6, number - 1, mode]
  );
  const bet = current.rows[0];
  const { last_bet: lastBet, mode_bet: modeBet } = previous.rows[0];
  const previousBotRound = botRound(number - 1, mode);
  const recentBots = [previousBotRound, ...[2, 3, 4, 5, 6].map((offset) => botRound(number - offset, mode))];
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
    offer: roundOffer(number, true, mode),
    bet: bet ? { stake: Number(bet.stake), placedAt: Number(bet.placed_ms) } : null,
    feed,
    latest: modeBet ?? previousBotRound,
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
      "SELECT count(*) FILTER (WHERE completed_rounds > season_start_rounds) AS total, " +
      "count(*) FILTER (WHERE completed_rounds > 0) AS played, " +
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
      "SELECT telegram_id AS id, display_name AS name, completed_rounds - season_start_rounds AS rounds, " +
      "game_net - season_start_net AS game_net FROM players WHERE telegram_id > 0 " +
      "AND completed_rounds > season_start_rounds ORDER BY game_net DESC, telegram_id LIMIT $1 OFFSET $2",
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

async function readDeposit(db: PoolClient, player: Player, row: PlayerRow): Promise<DepositState> {
  const { rows } = await db.query<{ now_ms: string; last_ms: string | null }>(
    "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms, " +
    "ceil(extract(epoch FROM greatest(welcome_granted_at, (SELECT claimed_at FROM hourly_virtual_deposits " +
    "WHERE telegram_id = $1 ORDER BY claimed_at DESC LIMIT 1))) * 1000)::bigint AS last_ms " +
    "FROM players WHERE telegram_id = $1", [player.id]
  );
  const now = Number(rows[0].now_ms);
  const availableAt = rows[0].last_ms === null ? now : Number(rows[0].last_ms) + DEPOSIT_COOLDOWN_MS;
  return { balance: Number(row.balance), now, availableAt };
}

export function getDeposit(player: Player) {
  return withPlayer(player, (db, row) => readDeposit(db, player, row));
}

export function deposit(player: Player, requestId: string) {
  return withPlayer(player, async (db, row): Promise<DepositClaim> => {
    const current = await readDeposit(db, player, row);
    const { rows } = await db.query<{ amount: number }>(
      "SELECT amount FROM hourly_virtual_deposits WHERE telegram_id = $1 AND request_id = $2", [player.id, requestId]
    );
    if (rows[0]) return { ...current, awarded: rows[0].amount };
    if (current.now < current.availableAt) throw new GameError("Наступне поповнення ще недоступне.", 429);
    if (!Number.isSafeInteger(current.balance + MAX_DEPOSIT)) throw new GameError("Досягнуто ліміту балансу.", 422);
    const awarded = randomInt(MAX_DEPOSIT + 1);
    await db.query(
      "INSERT INTO hourly_virtual_deposits (telegram_id, request_id, claimed_at, amount) " +
      "VALUES ($1,$2,to_timestamp($3::double precision / 1000),$4)",
      [player.id, requestId, current.now, awarded]
    );
    await db.query("UPDATE players SET balance = balance + $2 WHERE telegram_id = $1", [player.id, awarded]);
    return { balance: current.balance + awarded, now: current.now, availableAt: current.now + DEPOSIT_COOLDOWN_MS, awarded };
  });
}

export function getPublicStats() {
  return transaction(async (db): Promise<PublicStats> => {
    const { rows } = await db.query<{ played: string; house_net: string }>(
      "WITH period AS (SELECT coalesce((SELECT started_at FROM help_statistics_reset), '-infinity'::timestamptz) AS cutoff), " +
      "bot_rounds AS (" +
      "SELECT telegram_id, stake - CASE WHEN winner = 'player' THEN pot ELSE 0 END AS net " +
      "FROM timed_bets, period WHERE result IS NOT NULL AND telegram_id > 0 " +
      "AND to_timestamp((round_number + 1)::double precision * CASE WHEN fair_odds THEN 60 ELSE 120 END) > cutoff " +
      "UNION ALL SELECT telegram_id, coalesce((result->>'stake')::bigint, 0) - CASE WHEN winner = 'player' THEN pot ELSE 0 END " +
      "FROM rounds, period WHERE telegram_id > 0 AND played_at > cutoff), " +
      "played_since_reset AS (SELECT telegram_id FROM bot_rounds UNION " +
      "SELECT b.telegram_id FROM private_bets b JOIN private_rounds r USING (code, number), period " +
      "WHERE b.telegram_id > 0 AND r.result->>'winner' IS NOT NULL AND to_timestamp((r.number + 1)::double precision * 60) > cutoff) " +
      "SELECT (SELECT count(*) FROM played_since_reset) AS played, (SELECT coalesce(sum(net), 0) FROM bot_rounds) AS house_net"
    );
    return { played: Number(rows[0].played), houseNet: Number(rows[0].house_net) };
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

export function openGame(player: Player, mode: RouletteMode) {
  return withPlayer(player, (db, row, now) => readState(db, player, row, now, mode));
}

export function placeBet(player: Player, bet: ModeBet) {
  return withPlayer(player, async (db, row, now) => {
    const { min, max } = ROULETTE_MODES[bet.mode];
    if (bet.stake < min || bet.stake > max) throw new GameError("Для цього режиму ставка має бути від " + min + " до " + max + " $.", 422);
    const saved = await db.query<BetRow>(
      "SELECT round_number, stake, mode FROM timed_bets WHERE telegram_id = $1 AND request_id = $2",
      [player.id, bet.requestId]
    );
    if (saved.rows[0]) {
      if (saved.rows[0].round_number !== bet.round || Number(saved.rows[0].stake) !== bet.stake || saved.rows[0].mode !== bet.mode) {
        throw new GameError("Цей запит уже використано для іншої ставки.", 409);
      }
      return readState(db, player, row, now, bet.mode);
    }
    if (bet.round !== roundNumber(now)) {
      throw new GameError("Раунд завершився. Перевірте ставку для нового раунду.", 409);
    }
    const current = await db.query(
      "SELECT 1 FROM timed_bets WHERE telegram_id = $1 AND round_number = $2 AND mode = $3",
      [player.id, bet.round, bet.mode]
    );
    if (current.rowCount) throw new GameError("Ви вже зробили ставку в цьому раунді.", 409);
    if (bet.stake > Number(row.balance)) throw new GameError("Недостатньо віртуальних коштів.", 422);
    const base = roundOffer(bet.round, true, bet.mode);
    const bots = liveOffer(base, bet.stake, base.endsAt, now);
    if (!Number.isSafeInteger(Number(row.balance) + totalPot(bots, 0))) {
      throw new GameError("Досягнуто ліміту балансу.", 422);
    }
    const updated = await db.query<PlayerRow>(
      "UPDATE players SET balance = balance - $2 WHERE telegram_id = $1 RETURNING " + playerFields,
      [player.id, bet.stake]
    );
    await db.query(
      "INSERT INTO timed_bets (telegram_id, round_number, request_id, stake, fair_odds, live_bots, mode, placed_ms) " +
      "VALUES ($1, $2, $3, $4, true, true, $5, $6)",
      [player.id, bet.round, bet.requestId, bet.stake, bet.mode, now]
    );
    return readState(db, player, updated.rows[0], now, bet.mode);
  });
}
