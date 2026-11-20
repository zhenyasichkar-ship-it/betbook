import { openGame, placeBet, type Bet } from "../../../lib/store";
import { GameError, identify } from "../../../lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function failed(error: unknown) {
  if (error instanceof GameError) {
    return Response.json({ error: error.message }, { status: error.status, headers: responseHeaders });
  }
  console.error("Помилка запиту Betbook", error instanceof Error ? error.name : "Невідома");
  return Response.json(
    { error: "Сервер Betbook тимчасово недоступний. Спробуйте ще раз." },
    { status: 500, headers: responseHeaders }
  );
}

export async function GET(request: Request) {
  try {
    return Response.json(await openGame(identify(request)), { headers: responseHeaders });
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  try {
    const player = identify(request);
    const value: Partial<Bet> | null = await request.json().catch(() => null);
    if (
      !value || typeof value.stake !== "number" || !Number.isSafeInteger(value.stake) || value.stake < 1 ||
      typeof value.round !== "number" || !Number.isSafeInteger(value.round) || value.round < 1 ||
      value.round > 2_147_483_647 || typeof value.requestId !== "string" || !uuid.test(value.requestId)
    ) {
      throw new GameError("Вкажіть ставку цілим числом від 1 віртуального $.", 400);
    }
    const bet = { stake: value.stake, round: value.round, requestId: value.requestId };
    return Response.json(await placeBet(player, bet), { headers: responseHeaders });
  } catch (error) {
    return failed(error);
  }
}
