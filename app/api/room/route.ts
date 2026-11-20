import { apiFailure, json, requestIdPattern } from "../../../lib/api";
import { betInRoom, createRoom, deleteRoom, joinRoom, listRooms, openRoom } from "../../../lib/rooms";
import { GameError, identify } from "../../../lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function roomCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-F0-9]{10}$/.test(code)) throw new GameError("Введіть код кімнати з 10 символів.", 400);
  return code;
}

export async function GET(request: Request) {
  try {
    const player = identify(request);
    const code = new URL(request.url).searchParams.get("code");
    return json(code === null ? await listRooms(player) : await openRoom(roomCode(code), player));
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const player = identify(request);
    const data = await request.json().catch(() => null);
    if (data?.action === "join") return json(await joinRoom(roomCode(data.code), player));
    if (data?.action === "delete") return json(await deleteRoom(roomCode(data.code), player));
    const validRequest = typeof data?.requestId === "string" && requestIdPattern.test(data.requestId);
    if (data?.action === "create" && validRequest) {
      const { minStake, maxStake } = data;
      if (!Number.isSafeInteger(minStake) || !Number.isSafeInteger(maxStake) || minStake < 1 || maxStake < minStake) {
        throw new GameError("Ліміти мають бути цілими числами. Максимум має бути не меншим за мінімум.", 400);
      }
      return json(await createRoom(player, data.requestId, { minStake, maxStake }));
    }
    if (data?.action === "bet" && validRequest && Number.isSafeInteger(data.stake) && data.stake > 0
      && Number.isSafeInteger(data.round) && data.round > 0 && data.round <= 2_147_483_647) {
      return json(await betInRoom(roomCode(data.code), player, data));
    }
    throw new GameError("Перевірте дані запиту або суму ставки.", 400);
  } catch (error) {
    return apiFailure(error);
  }
}
