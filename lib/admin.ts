export const MAX_ADMIN_CREDIT = 1_000_000;
export const LEADERBOARD_PAGE_SIZE = 25;

export type AdminStats = {
  played: number;
  losing: number;
  netLoss: number;
  balance: number;
  pending: boolean;
  leaderboard: {
    page: number;
    total: number;
    pages: number;
    players: { id: string; name: string; rounds: number; net: number }[];
  };
};
