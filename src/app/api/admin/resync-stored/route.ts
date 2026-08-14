// Пересинк уже сохранённых в складе дней — после правок расчёта комиссии, чтобы и
// история стала копейка-в-копейку. Идём порциями (?limit=4&after=YYYY-MM-DD), чтобы
// уложиться в лимит функции. Сессионная авторизация.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";
import { config } from "@/lib/config";
import { syncDay } from "@/lib/services/dailyStats";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(6, Math.max(1, Number(sp.get("limit") || 4)));
    const after = sp.get("after") || "";

    const rows = await prisma.driverDailyStat.findMany({
      select: { date: true },
      distinct: ["date"],
      orderBy: { date: "asc" },
    });
    const allDays = rows.map((r: { date: Date }) => r.date.toISOString().slice(0, 10));
    const todo = allDays.filter((d: string) => d > after).slice(0, limit);

    const done: string[] = [];
    for (const d of todo) {
      await syncDay(d);
      done.push(d);
    }
    const nextAfter = done.length ? done[done.length - 1] : after;
    const remaining = allDays.filter((d: string) => d > nextAfter).length;
    return NextResponse.json({ ok: true, totalStored: allDays.length, resynced: done, nextAfter, remaining });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
