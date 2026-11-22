import type { Participant, Round } from "./game";

export const ROOM_LIMIT = 12;
export type RoomLimits = { minStake: number; maxStake: number };

export type RoomSummary = { code: string; members: number };
export type RoomResult = Pick<Round, "number" | "pot" | "participants" | "houseFee"> & { winner: string | null };
export type RoomState = RoomSummary & RoomLimits & {
  canDelete: boolean;
  now: number;
  number: number;
  endsAt: number;
  balance: number;
  selfId: string;
  stake: number;
  pot: number;
  participants: Participant[];
  latest: RoomResult | null;
};
