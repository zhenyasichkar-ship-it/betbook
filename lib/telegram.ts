import { createHmac, timingSafeEqual } from "node:crypto";

export class GameError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export type Player = { id: string; name: string };

export function isAdmin(player: Player) {
  return player.id !== "0" && !!process.env.ADMIN_TELEGRAM_IDS
    ?.split(",").map((id) => id.trim()).includes(player.id);
}

export function identifyAdmin(request: Request) {
  const player = identify(request);
  if (!isAdmin(player)) throw new GameError("Доступ до адміністрування заборонено.", 403);
  return player;
}

const MAX_AGE_SECONDS = 12 * 60 * 60;
const INVALID = "Відкрийте Betbook знову з меню бота в Telegram.";

export function identify(request: Request): Player {
  const authorization = request.headers.get("authorization");
  if (
    !authorization &&
    process.env.NODE_ENV === "development" &&
    process.env.BETBOOK_LOCAL_DEMO === "1" &&
    ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
  ) {
    return { id: "0", name: "Демогравець" };
  }

  if (!authorization?.startsWith("tma ") || authorization.length > 8192) {
    throw new GameError(INVALID, 401);
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new GameError("Токен Telegram ще не налаштовано на сервері.", 503);
  }

  const params = new URLSearchParams(authorization.slice(4));
  const keys = [...params.keys()];
  const hash = params.get("hash") ?? "";
  if (new Set(keys).size !== keys.length || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new GameError(INVALID, 401);
  }
  params.delete("hash");
  params.sort();
  const check = [...params.entries()].map(([key, value]) => key + "=" + value).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) {
    throw new GameError(INVALID, 401);
  }

  const date = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(date) || date < now - MAX_AGE_SECONDS || date > now + 30) {
    throw new GameError(INVALID, 401);
  }

  let user: { id?: unknown; first_name?: unknown; last_name?: unknown } | null;
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    throw new GameError(INVALID, 401);
  }
  if (typeof user?.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new GameError(INVALID, 401);
  }
  const name = [user.first_name, user.last_name]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .replaceAll("\u0000", "")
    .trim()
    .slice(0, 120);
  return { id: String(user.id), name: name || "Гравець" };
}
