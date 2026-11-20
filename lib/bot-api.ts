import { createHmac } from "node:crypto";

export function webhookSecret(token: string) {
  return createHmac("sha256", token).update("betbook-telegram-webhook-v1").digest("hex");
}

export async function telegramBot<T>(token: string, method: string, body = {}): Promise<T> {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
    cache: "no-store"
  }).catch(() => { throw new Error("Не вдалося з’єднатися з Telegram Bot API."); });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error("Telegram відхилив " + method + " (HTTP " + response.status + ").");
  return result.result as T;
}
