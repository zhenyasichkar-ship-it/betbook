import { MAX_ADMIN_CREDIT } from "../../../lib/admin";
import { apiFailure, json, requestIdPattern } from "../../../lib/api";
import { addAdminCredits, getAdminStats } from "../../../lib/store";
import { GameError, identifyAdmin } from "../../../lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return json(await getAdminStats(identifyAdmin(request)));
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const player = identifyAdmin(request);
    const data = await request.json().catch(() => null);
    if (
      !data || !Number.isSafeInteger(data.amount) || data.amount < 1 || data.amount > MAX_ADMIN_CREDIT ||
      typeof data.requestId !== "string" || !requestIdPattern.test(data.requestId)
    ) {
      throw new GameError("Вкажіть цілу суму від 1 до 1 000 000 віртуальних $.", 400);
    }
    return json(await addAdminCredits(player, data.amount, data.requestId));
  } catch (error) {
    return apiFailure(error);
  }
}
