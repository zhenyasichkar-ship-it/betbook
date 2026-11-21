export const MAX_DEPOSIT = 100;
export const DEPOSIT_COOLDOWN_MS = 60 * 60 * 1000;

export type DepositState = {
  balance: number;
  now: number;
  availableAt: number;
};

export type DepositClaim = DepositState & { awarded: number };

export type PublicStats = {
  played: number;
  houseNet: number;
  deposited: number;
  lost: number;
};
