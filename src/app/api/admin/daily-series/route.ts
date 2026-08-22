// Посуточная сводка за последние N дней (из склада DriverDailyStat) для «Обзора».
// На каждый день: прибыль (комиссия парка), число активных водителей, заказы.
// Быстрый один groupBy по складу. Свежие дни появляются по мере ночного досинка.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";
import { mskDateStr } from "@/lib/services/dailyStats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") || 30)));
    const from = new Date(`${mskDateStr(days - 1)}T00:00:00.000Z`);
    // Считаем только АКТИВНЫХ за день: заказ и/или прибыль > 0.
    // (склад пишет строку на каждого водителя парка, поэтому фильтруем нулевые).
    const rows = await prisma.driverDailyStat.groupBy({
      by: ["date"],
      where: { date: { gte: from }, OR: [{ orders: { gt: 0 } }, { parkCommission: { gt: 0 } }] },
      _sum: { orders: true, parkCommission: true },
      _count: { _all: true },
      orderBy: { date: "asc" },
    });
    const series = (rows as any[]).map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      orders: r._sum?.orders ?? 0,
      commission: Number(r._sum?.parkCommission ?? 0),
      drivers: r._count?._all ?? 0,
    }));
    return NextResponse.json({ ok: true, days, series });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
