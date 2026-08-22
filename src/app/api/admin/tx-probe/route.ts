// ДИАГНОСТИКА: проверяем, отдаёт ли Fleet транзакции всего парка одним запросом
// (без фильтра по водителю) и есть ли в записи привязка к водителю.
// /api/admin/tx-probe?token=XXX&date=2026-08-20
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { authed } from "@/lib/auth";
import { FleetClient } from "@/lib/fleet";
import { mskDayWindow, mskDateStr } from "@/lib/services/dailyStats";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const date = req.nextUrl.searchParams.get("date") ?? mskDateStr(2);
    const { from, to } = mskDayWindow(date);
    const r = (await new FleetClient().probeParkTransactions(from, to)) as any;
    const keys: string[] = r.sampleKeys || [];
    const driverKey = keys.find((k) => /driver/i.test(k)) || null;
    return NextResponse.json({
      ok: true,
      date,
      pageLen: r.pageLen,
      hasCursor: r.hasCursor,
      sampleKeys: keys,
      hasDriverAttribution: keys.some((k) => /driver/i.test(k)),
      driverKey,
      sample: r.sample,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
