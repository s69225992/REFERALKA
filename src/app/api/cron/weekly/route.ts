// Еженедельный cron-эндпоинт (запускается Vercel Cron по расписанию из vercel.json).
// Защищён CRON_SECRET: Vercel шлёт "Authorization: Bearer <CRON_SECRET>".
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { runWeeklyCycle } from "@/lib/services/cycle";

export const maxDuration = 300; // сек (для больших парков дробите задачу на пачки)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!config.cronSecret || auth !== `Bearer ${config.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    config.assertFleet();
    const result = await runWeeklyCycle();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
