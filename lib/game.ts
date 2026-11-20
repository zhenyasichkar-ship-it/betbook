export const DAILY_BONUS = 100;
export const INTRO_ROUNDS = 3;
const BOT_ADVANTAGE = 0.08;

export const BOTS = [
  { id: "nova", name: "Nova", initials: "NV", color: "#b488ff" },
  { id: "mako", name: "Mako", initials: "MK", color: "#55ebdc" },
  { id: "rio", name: "Rio", initials: "RI", color: "#ffac75" }
] as const;

export type BotId = (typeof BOTS)[number]["id"];
export type Participant = {
  id: "player" | BotId;
  name: string;
  initials: string;
  color: string;
  stake: number;
  share: number;
  chance: number;
};
export type RoundOffer = { number: number; botStakes: readonly number[] };
export type Round = {
  number: number;
  winner: Participant["id"];
  participants: Participant[];
  stake: number;
  pot: number;
};
export type GameState = {
  profile: {
    name: string;
    balance: number;
    rounds: number;
    net: number;
    netLoss: number;
    bonusDay: string;
  };
  offer: RoundOffer;
  feed: { bot: BotId; pot: number }[];
  latest: Round | null;
};

const BOT_STAKES = [
  [8, 5, 3], [3, 2, 2], [7, 4, 3], [4, 3, 2],
  [3, 2, 1], [12, 6, 3], [4, 3, 1], [5, 5, 2]
] as const;

export function roundOffer(number: number): RoundOffer {
  return { number, botStakes: BOT_STAKES[(number - 1) % BOT_STAKES.length] };
}

export function totalPot(offer: RoundOffer, stake: number) {
  return offer.botStakes.reduce((total, amount) => total + amount, stake);
}

export function lineup(offer: RoundOffer, stake: number): Participant[] {
  const pot = totalPot(offer, stake);
  const share = stake / pot;
  const chance = stake <= 0 ? 0 : offer.number <= INTRO_ROUNDS ? 1 : share * BOT_ADVANTAGE;
  const botsPot = pot - stake;
  return [
    { id: "player", name: "Вы", initials: "ВЫ", color: "#ff75b9", stake, share, chance },
    ...BOTS.map((bot, index) => {
      const amount = offer.botStakes[index];
      return { ...bot, stake: amount, share: amount / pot, chance: (1 - chance) * amount / botsPot };
    })
  ];
}

export function resolveRound(offer: RoundOffer, stake: number, draw: number): Round {
  const participants = lineup(offer, stake);
  let remainder = draw;
  let winner = participants[participants.length - 1].id;
  for (const participant of participants) {
    remainder -= participant.chance;
    if (remainder < 0) {
      winner = participant.id;
      break;
    }
  }
  return { number: offer.number, winner, participants, stake, pot: totalPot(offer, stake) };
}
