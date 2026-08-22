// Порционная догрузка склада за диапазон дат. За один вызов синкает столько дней,
// сколько успевает в бюджет времени (не упираясь в лимит функции). Уже существующие
// дни пропускает (skip=1 по умолчанию), поэтому повторные прогоны дешёвые.
// Пример: /api/admin/sync-range-batch?token=XXX&from=2025-08-22&to=2026-08-22&budget=240000
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";
import { config } from "@/lib/config";
import { syncDay } from "@/lib/services/dailyStats";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function dstr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const sp = req.nextUrl.searchParams;
    const fromStr = sp.get("from");
    const toStr = sp.get("to") || dstr(new Date());
    if (!fromStr) return NextResponse.json({ error: "from (YYYY-MM-DD) required" }, { status: 400 });
    const budget = Math.min(285000, Math.max(30000, Number(sp.get("budget") || 240000)));
    const skipExisting = sp.get("skip") !== "0";

    const started = Date.now();
    const end = new Date(`${toStr}T00:00:00.000Z`);
    let cur = new Date(`${fromStr}T00:00:00.000Z`);
    const done: string[] = [];
    const skipped: string[] = [];
    let nextFrom: string | null = null;

    for (; cur.getTime() <= end.getTime(); cur = new Date(cur.getTime() + 86400000)) {
      const ds = dstr(cur);
      if (Date.now() - started > budget) { nextFrom = ds; break; }
      if (skipExisting) {
        const c = await prisma.driverDailyStat.count({ where: { date: new Date(`${ds}T00:00:00.000Z`) } });
        if (c > 0) { skipped.push(ds); continue; }
      }
      try { await syncDay(ds, false); done.push(ds); }
      catch { nextFrom = ds; break; } // сорвалось на этом дне — вернём его как точку продолжения
    }

    let remaining = 0;
    if (nextFrom) {
      remaining = Math.round((end.getTime() - new Date(`${nextFrom}T00:00:00.000Z`).getTime()) / 86400000) + 1;
    }
    return NextResponse.json({
      ok: true,
      done,
      skipped: skipped.length,
      syncedCount: done.length,
      nextFrom,
      remaining,
      reachedEnd: !nextFrom,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
