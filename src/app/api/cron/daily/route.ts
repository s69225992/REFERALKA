// Суточный cron: дотягивает вчерашние (закрытые московские) сутки в склад DriverDailyStat.
// Расписание в vercel.json; Vercel шлёт "Authorization: Bearer <CRON_SECRET>".
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { syncDay, mskDateStr } from "@/lib/services/dailyStats";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!config.cronSecret || auth !== `Bearer ${config.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    config.assertFleet();
    const result = await syncDay(mskDateStr(1)); // вчера по Москве
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
