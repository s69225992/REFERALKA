// Диагностика подсчёта заказов: сырой вызов ordersByDriver за один московский день.
// Показывает total (по ended_at), статусы, есть ли поле ended_at у заказов и топ-водителей.
// Пример: /api/admin/orders-debug?token=XXX&date=2026-08-14
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { authed } from "@/lib/auth";
import { FleetClient } from "@/lib/fleet";
import { mskDayWindow, mskDateStr } from "@/lib/services/dailyStats";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const date = req.nextUrl.searchParams.get("date") ?? mskDateStr(1);
    const { from, to } = mskDayWindow(date);
    const r = await new FleetClient().ordersByDriver(from, to);
    const topDrivers = Object.entries(r.byDriver)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([yid, n]) => ({ yid, n }));
    return NextResponse.json({
      ok: true,
      date,
      window: { from, to },
      total: r.total,
      completeSeen: r.completeSeen,
      withEndedAt: r.withEndedAt,
      hasEndedAtField: r.sampleKeys.includes("ended_at"),
      statusCounts: r.statusCounts,
      sampleKeys: r.sampleKeys,
      topDrivers,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
