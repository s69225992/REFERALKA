// Заполнение склада посуточной статистики. Защита ADMIN_TOKEN.
// Один день:   /api/admin/sync-day?token=XXX&date=2026-08-12
// Диапазон:    /api/admin/sync-day?token=XXX&from=2026-08-01&to=2026-08-12
// Без дат — вчерашние московские сутки.
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { authed } from "@/lib/auth";
import { syncDay, syncRange, mskDateStr } from "@/lib/services/dailyStats";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function run(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    if (from && to) {
      const result = await syncRange(from, to);
      return NextResponse.json({ ok: true, result });
    }
    const date = sp.get("date") ?? mskDateStr(1); // по умолчанию — вчера
    const result = await syncDay(date);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
