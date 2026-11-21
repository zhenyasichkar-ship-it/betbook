export const DAILY_DEPOSIT_LIMIT = 100;

export type DepositState = {
  balance: number;
  remaining: number;
};

export type PublicStats = {
  played: number;
  houseNet: number;
};
