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
    const started = Date.now();
    // Бюджет времени на добор (мах функции 300с): наполняем пропуски, пока не упрёмся
    // в бюджет или в лимит дней. Так за ночь латается больше дырок, но без таймаута.
    const budgetMs = Number(process.env.CRON_BUDGET_MS ?? 210000); // ~3.5 мин на добор
    const maxGaps = Number(process.env.CRON_MAX_GAPS ?? 12);
    const lookbackDays = Number(process.env.CRON_LOOKBACK_DAYS ?? 90);
    // 1) устоявшийся день на границе живого окна
    const boundary = mskDateStr(LIVE_RECENT_DAYS);
    const results = [await syncDay(boundary)];
    // 2) самозаполнение: докидываем пропущенные старые дни (старые — первыми), пока
    //    хватает бюджета времени. За несколько ночей склад догоняет всю историю.
    const gaps = await missingDays(mskDateStr(lookbackDays), mskDateStr(LIVE_RECENT_DAYS));
    const backfilled: string[] = [];
    for (const d of gaps) {
      if (backfilled.length >= maxGaps) break;
      if (Date.now() - started > budgetMs) break; // оставляем запас до лимита функции
      await syncDay(d);
      backfilled.push(d);
    }
    return NextResponse.json({
      ok: true,
      boundary,
      backfilled,
      gapsFound: gaps.length,
      gapsRemaining: gaps.length - backfilled.length,
      results,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
