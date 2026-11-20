import { telegramBot, webhookSecret } from "../lib/bot-api.ts";

const configuredOrigin = process.env.BETBOOK_WEBHOOK_ORIGIN;
if (configuredOrigin && (!process.env.VERCEL || process.env.VERCEL_ENV === "production")) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Не налаштовано TELEGRAM_BOT_TOKEN.");
  const url = new URL("/api/telegram/webhook", configuredOrigin);
  if (url.protocol !== "https:") throw new Error("Для вебхука Betbook потрібен HTTPS.");
  const existing = await telegramBot(token, "getWebhookInfo");
  if (existing.url && existing.url !== url.href) {
    throw new Error("У бота вже налаштований вебхук за іншою адресою.");
  }
  await telegramBot(token, "setWebhook", {
    url: url.href,
    secret_token: webhookSecret(token),
    allowed_updates: ["message"]
  });
  const registered = await telegramBot(token, "getWebhookInfo");
  if (registered.url !== url.href) throw new Error("Telegram не підтвердив адресу вебхука.");
  console.log("Вебхук Betbook підключено.");
}
