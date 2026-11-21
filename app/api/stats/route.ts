import { apiFailure } from "../../../lib/api";
import { getPublicStats } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getPublicStats(), { headers: { "Cache-Control": "public, s-maxage=30" } });
  } catch (error) {
    return apiFailure(error);
  }
}
