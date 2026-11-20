export const MAX_ADMIN_CREDIT = 1_000_000;

export type AdminStats = {
  played: number;
  losing: number;
  netLoss: number;
  balance: number;
  pending: boolean;
  losses: { id: string; name: string; rounds: number; netLoss: number }[];
};
