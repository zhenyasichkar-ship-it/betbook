export const DAILY_BONUS = 100;
export const ROUND_MS = 60_000;

const NAMES = "Неон Луна Тайфун Сіріус Рись Мавка Онікс Кобра Сонар Барс Міраж Вихор Кварц Сокіл Туман Хвиля Флінт Фенікс Клен Бурштин Грім Спалах Крук Лотос Іскра Сапфір Сова Ріф Скат Оріон Сірко Метеор Пульс Обрій М’ята Тайга Сойка Комета Радар Варта Берег Злива Гейзер Лава Атлас Шторм Блиск Дюна".split(" ");
const COLORS = ["#ac84fa", "#56e8d7", "#ffae72", "#63afff", "#ef8aeb", "#d5e973", "#f77a77", "#8be5ff", "#f8d589", "#b0f38c", "#8879ff", "#ff97c1"];

export type Avatar = { name: string; color: string; avatar: number };
type Contestant = Avatar & { id: string; stake: number };
export type Participant = Contestant & { share: number; chance: number };
export type RoundOffer = { number: number; endsAt: number; bots: Contestant[] };
export type Round = {
  number: number;
  winner: string;
  participants: Participant[];
  stake: number;
  pot: number;
};
export type GameState = {
  now: number;
  profile: Avatar & { balance: number; rounds: number; netLoss: number; bonusDay: string; isAdmin: boolean };
  offer: RoundOffer;
  bet: { stake: number } | null;
  feed: (Avatar & { round: number; pot: number; key: string })[];
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

export function roundOffer(number: number): RoundOffer {
  const random = randomFor(number);
  const pool = [...NAMES];
  const count = 8 + Math.floor(random() * 5);
  const bots = COLORS.slice(0, count).map((color) => {
    const index = Math.floor(random() * pool.length);
    const [name] = pool.splice(index, 1);
    const id = NAMES.indexOf(name);
    return { id: "bot-" + id, name, avatar: Math.imul(id + 13, 0x7feb352d) >>> 0, color,
      stake: 1 + Math.floor(random() * (number % 5 === 0 ? 20 : 6)) };
  });
  return { number, endsAt: (number + 1) * ROUND_MS, bots };
}

export function totalPot(offer: RoundOffer, stake: number) {
  return offer.bots.reduce((total, bot) => total + bot.stake, stake);
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
  return { number: offer.number, winner, participants, stake, pot: totalPot(offer, stake) };
}

export function botRound(number: number) {
  const offer = roundOffer(number);
  const ticket = Math.floor(randomFor(number ^ 0x51a537)() * totalPot(offer, 0));
  return resolveRound(offer, 0, { name: "", avatar: 0, color: "" }, ticket);
}
