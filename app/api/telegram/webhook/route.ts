import { timingSafeEqual } from "node:crypto";
import { apiFailure, json } from "../../../../lib/api";
import { telegramBot, webhookSecret } from "../../../../lib/bot-api";
import { welcomeOnce } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WELCOME = "Вітаємо в Betbook! Тут ти зможешь зіграти в казино, не втративши ні Копійки";

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ ok: false }, 503);
  const signature = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(webhookSecret(token)))) {
    return json({ ok: false }, 401);
  }
  try {
    const update = await request.json().catch(() => null);
    const message = update?.message;
    const chatId = message?.chat?.id;
    if (
      message?.chat?.type === "private" && Number.isSafeInteger(chatId) && chatId > 0 &&
      typeof message.text === "string" && /^\/start(?:@[a-z0-9_]+)?(?:\s|$)/i.test(message.text)
    ) {
      const origin = new URL(request.url).origin;
      await welcomeOnce(chatId, () => telegramBot(token, "sendMessage", {
        chat_id: chatId,
        text: WELCOME,
        ...(origin.startsWith("https://") ? {
          reply_markup: { inline_keyboard: [[{ text: "Відкрити Betbook", web_app: { url: origin } }]] }
        } : {})
      }));
    }
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
