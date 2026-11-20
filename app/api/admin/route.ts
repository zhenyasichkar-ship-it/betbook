import { MAX_ADMIN_CREDIT } from "../../../lib/admin";
import { apiFailure, json, requestIdPattern } from "../../../lib/api";
import { addAdminCredits, getAdminStats } from "../../../lib/store";
import { settleExpiredRooms } from "../../../lib/rooms";
import { GameError, identifyAdmin } from "../../../lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const player = identifyAdmin(request);
    const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
    if (!Number.isSafeInteger(page) || page < 1) throw new GameError("Недійсний номер сторінки.", 400);
    const possiblyPendingRooms = await settleExpiredRooms();
    const stats = await getAdminStats(player, page);
    return json({ ...stats, pending: stats.pending || possiblyPendingRooms });
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
