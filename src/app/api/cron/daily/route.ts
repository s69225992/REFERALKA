// Суточный cron: дотягивает в склад DriverDailyStat день, который только что «закрылся».
// Живьём показываем последние LIVE_RECENT_DAYS (по умолчанию 4) суток, а день на границе
// (4 дня назад) к этому моменту уже устоялся у Яндекса — его и фиксируем в склад.
// Расписание в vercel.json; Vercel шлёт "Authorization: Bearer <CRON_SECRET>".
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { syncDay, mskDateStr, missingDays } from "@/lib/services/dailyStats";

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
    // 1) устоявшийся день на границе живого окна
    const boundary = mskDateStr(LIVE_RECENT_DAYS);
    const results = [await syncDay(boundary)];
    // 2) самозаполнение: докинуть до 3 пропущенных старых дней за последние 30 суток
    //    (за несколько ночей склад догоняет месяц истории без ручного бэкфилла)
    const gaps = (await missingDays(mskDateStr(30), mskDateStr(LIVE_RECENT_DAYS))).slice(0, 3);
    for (const d of gaps) results.push(await syncDay(d));
    return NextResponse.json({ ok: true, boundary, backfilled: gaps, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
