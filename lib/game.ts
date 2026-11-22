export const DAILY_BONUS = 100;
export const ROUND_MS = 60_000;
export const HOUSE_FEE_PERCENT = 5;
export const ROULETTE_MODES = {
  low: { min: 1, max: 50, presets: [1, 10, 25, 50], seed: 0x249e3a },
  medium: { min: 10, max: 200, presets: [10, 50, 100, 200], seed: 0x72a0d8 },
  high: { min: 50, max: 500, presets: [50, 100, 250, 500], seed: 0x102b67 }
} as const;
export type RouletteMode = keyof typeof ROULETTE_MODES;
export const DEFAULT_MODE: RouletteMode = "low";

export function isRouletteMode(value: unknown): value is RouletteMode {
  return value === "low" || value === "medium" || value === "high";
}

const NAMES = "Неон Луна Тайфун Сіріус Рись Мавка Онікс Кобра Сонар Барс Міраж Вихор Кварц Сокіл Туман Хвиля Флінт Фенікс Клен Бурштин Грім Спалах Крук Лотос Іскра Сапфір Сова Ріф Скат Оріон Сірко Метеор Пульс Обрій М’ята Тайга Сойка Комета Радар Варта Берег Злива Гейзер Лава Атлас Шторм Блиск Дюна".split(" ");
const COLORS = ["#ac84fa", "#56e8d7", "#ffae72", "#63afff", "#ef8aeb", "#d5e973", "#f77a77", "#8be5ff", "#f8d589", "#b0f38c", "#8879ff", "#ff97c1"];

export type Avatar = { name: string; color: string; avatar: number };
type Contestant = Avatar & { id: string; stake: number; depositAt?: number; responseRate?: number };
export type Participant = Contestant & { share: number; chance: number };
export type RoundOffer = { number: number; endsAt: number; bots: Contestant[]; live: boolean; mode: RouletteMode | "legacy" };
export type Round = {
  number: number;
  mode?: RouletteMode;
  winner: string;
  participants: Participant[];
  stake: number;
  pot: number;
  houseFee?: number;
};
export type GameState = {
  now: number;
  profile: Avatar & { balance: number; rounds: number; netLoss: number; bonusDay: string; isAdmin: boolean };
  offer: RoundOffer;
  bet: { stake: number; placedAt: number } | null;
  feed: (Avatar & { round: number; pot: number; payout?: number; key: string })[];
  latest: Round;
  lastBet: Round | null;
};

function randomFor(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function roundNumber(now: number) {
  return Math.floor(now / ROUND_MS);
}

export function legacyRoundNumber(now: number) {
  return Math.floor(now / 120_000);
}

export function roundOffer(number: number, live = true, mode: RoundOffer["mode"] = "legacy"): RoundOffer {
  const limits = mode === "legacy" ? null : ROULETTE_MODES[mode];
  const random = randomFor(number ^ (limits?.seed ?? 0));
  const pool = [...NAMES];
  const count = limits ? 2 + Math.floor(random() * 5) : live ? 3 : 8 + Math.floor(random() * 5);
  const bots = COLORS.slice(0, count).map((color, order) => {
    const index = Math.floor(random() * pool.length);
    const [name] = pool.splice(index, 1);
    const id = NAMES.indexOf(name);
    const identity = { id: "bot-" + id, name, avatar: Math.imul(id + 13, 0x7feb352d) >>> 0, color };
    if (!limits) {
      return { ...identity, stake: live ? 18 + Math.floor(random() * 23) : 1 + Math.floor(random() * (number % 5 === 0 ? 20 : 6)) };
    }
    const progress = ((order + 0.15 + random() * 0.7) / count) ** 0.8;
    return {
      ...identity,
      stake: limits.min + Math.floor((limits.max - limits.min) * (0.18 + random() * 0.42) * (0.55 + progress * 0.45)),
      depositAt: number * ROUND_MS + 2500 + Math.floor(55_000 * progress),
      responseRate: 0.29 + random() * 0.33
    };
  });
  return { number, endsAt: (number + 1) * ROUND_MS, bots, live, mode };
}

export function liveOffer(offer: RoundOffer, playerStake: number, now: number, placedAt = Infinity): RoundOffer {
  if (offer.mode !== "legacy") {
    const { max } = ROULETTE_MODES[offer.mode];
    const bots = offer.bots.flatMap((bot) => {
      if (bot.depositAt === undefined || bot.depositAt > now) return [];
      const boost = placedAt < bot.depositAt ? Math.floor(playerStake * (bot.responseRate ?? 0)) : 0;
      return [{ ...bot, stake: Math.min(max, bot.stake + boost) }];
    });
    return { ...offer, bots };
  }
  if (!offer.live) return offer;
  const elapsed = Math.max(0, Math.min(ROUND_MS, now - offer.endsAt + ROUND_MS));
  const supportedStake = Math.min(playerStake, Math.max(0, Number.MAX_SAFE_INTEGER - playerStake - 125));
  const bots = offer.bots.map((bot, index) => {
    const delay = 2500 * index;
    const progress = Math.max(0, (elapsed - delay) / (ROUND_MS - delay));
    const stage = Math.floor(progress ** 1.8 * 12) / 12;
    const target = bot.stake + Math.floor(supportedStake * (0.19 + (bot.avatar % 14) / 100));
    return { ...bot, stake: 2 + Math.floor((target - 2) * stage) };
  });
  return { ...offer, bots };
}
export function totalPot(offer: RoundOffer, stake: number) {
  return offer.bots.reduce((total, bot) => total + bot.stake, stake);
}

export function calculateHouseFee(pot: number) {
  return Math.round(pot / (100 / HOUSE_FEE_PERCENT));
}

export function payoutAfterFee({ pot, houseFee = 0 }: Pick<Round, "pot" | "houseFee">) {
  return pot - houseFee;
}

export function lineup(offer: RoundOffer, stake: number, player: Avatar): Participant[] {
  const pot = totalPot(offer, stake);
  const share = stake / pot;
  const bots = offer.bots.map((bot) => ({ ...bot, share: bot.stake / pot, chance: bot.stake / pot }));
  if (!stake) return bots;
  return [{ ...player, id: "player", stake, share, chance: share }, ...bots];
}

export function resolveRound(offer: RoundOffer, stake: number, player: Avatar, draw: number, legacyFactor?: number | null): Round {
  const participants = lineup(offer, stake, player);
  // Only already-accepted two-minute bets use their saved rules and normalized draw.
  if (legacyFactor !== undefined && stake > 0) {
    const [entry, ...bots] = participants;
    entry.chance = legacyFactor === null ? 1 : entry.share * legacyFactor;
    const botPot = totalPot(offer, 0);
    for (const bot of bots) bot.chance = (1 - entry.chance) * bot.stake / botPot;
  }
  let remainder = draw;
  let winner = participants[participants.length - 1].id;
  for (const participant of participants) {
    remainder -= legacyFactor === undefined ? participant.stake : participant.chance;
    if (remainder < 0) {
      winner = participant.id;
      break;
    }
  }
  return { number: offer.number, winner, participants, stake, pot: totalPot(offer, stake),
    ...(offer.mode === "legacy" ? {} : { mode: offer.mode }) };
}

export function botRound(number: number, mode: RouletteMode) {
  const base = roundOffer(number, true, mode);
  const offer = liveOffer(base, 0, base.endsAt);
  const pot = totalPot(offer, 0);
  const ticket = Math.floor(randomFor(number ^ 0x51a537 ^ ROULETTE_MODES[mode].seed)() * pot);
  return { ...resolveRound(offer, 0, { name: "", avatar: 0, color: "" }, ticket), houseFee: calculateHouseFee(pot) };
}
