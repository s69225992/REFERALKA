// Суточный cron: дотягивает в склад DriverDailyStat день, который только что «закрылся».
// Живьём показываем последние LIVE_RECENT_DAYS (по умолчанию 4) суток, а день на границе
// (4 дня назад) к этому моменту уже устоялся у Яндекса — его и фиксируем в склад.
// Расписание в vercel.json; Vercel шлёт "Authorization: Bearer <CRON_SECRET>".
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { syncDay, mskDateStr } from "@/lib/services/dailyStats";

const LIVE_RECENT_DAYS = Number(process.env.LIVE_RECENT_DAYS ?? 4);

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!config.cronSecret || auth !== `Bearer ${config.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    config.assertFleet();
    const result = await syncDay(mskDateStr(LIVE_RECENT_DAYS)); // день на границе живого окна (уже устоялся)
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
