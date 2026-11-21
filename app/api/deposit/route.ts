import { apiFailure, json, requestIdPattern } from "../../../lib/api";
import { deposit, getDeposit } from "../../../lib/store";
import { GameError, identify } from "../../../lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return json(await getDeposit(identify(request)));
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const player = identify(request);
    const data = await request.json().catch(() => null);
    if (!data || typeof data.requestId !== "string" || !requestIdPattern.test(data.requestId)) {
      throw new GameError("Недійсний запит на поповнення.", 400);
    }
    return json(await deposit(player, data.requestId));
  } catch (error) {
    return apiFailure(error);
  }
}
