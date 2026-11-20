import { openGame, placeBet, type Bet } from "../../../lib/store";
import { GameError, identify } from "../../../lib/telegram";
import { apiFailure, json, requestIdPattern } from "../../../lib/api";
import { settleExpiredRooms } from "../../../lib/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const player = identify(request);
    await settleExpiredRooms(player.id);
    return json(await openGame(player));
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const player = identify(request);
    const value: Partial<Bet> | null = await request.json().catch(() => null);
    if (
      !value || typeof value.stake !== "number" || !Number.isSafeInteger(value.stake) || value.stake < 1 ||
      typeof value.round !== "number" || !Number.isSafeInteger(value.round) || value.round < 1 ||
      value.round > 2_147_483_647 || typeof value.requestId !== "string" || !requestIdPattern.test(value.requestId)
    ) {
      throw new GameError("Вкажіть ставку цілим числом від 1 віртуального $.", 400);
    }
    const bet = { stake: value.stake, round: value.round, requestId: value.requestId };
    await settleExpiredRooms(player.id);
    return json(await placeBet(player, bet));
  } catch (error) {
    return apiFailure(error);
  }
}
