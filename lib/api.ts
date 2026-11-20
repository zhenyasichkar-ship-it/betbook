import { GameError } from "./telegram";

export const requestIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiFailure(error: unknown) {
  if (error instanceof GameError) return json({ error: error.message }, error.status);
  console.error("Помилка запиту Betbook", error instanceof Error ? error.name : "Невідома");
  return json({ error: "Сервер Betbook тимчасово недоступний. Спробуйте ще раз." }, 500);
}
