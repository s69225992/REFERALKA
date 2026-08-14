// Служебный разбор транзакций водителя по категориям за период — для сверки комиссии
// с отчётом Fleet. ?driverId=<id в нашей БД>&from=..&to=.. (сессионная авторизация).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";
import { config } from "@/lib/config";
import { FleetClient } from "@/lib/fleet";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const driverId = Number(sp.get("driverId"));
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  if (!driverId || !from || !to)
    return NextResponse.json({ error: "driverId, from, to required" }, { status: 400 });

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) return NextResponse.json({ error: "driver not found" }, { status: 404 });

  const client = new FleetClient();
  const allowed = new Set(config.referral.commissionCategoryIds);

  // легенда категорий
  const legend: Record<string, string> = {};
  try {
    for (const c of await client.listTransactionCategories()) {
      if (c.id) legend[c.id as string] = (c.name as string) ?? (c.id as string);
    }
  } catch {
    /* ignore */
  }

  const txs = await client.listDriverTransactions(driver.yandexDriverId, from, to);
  // группируем по категории: сумма всех, сумма отрицательных (модуль)
  const byCat: Record<string, { count: number; sum: number; negAbs: number }> = {};
  for (const tx of txs) {
    const cat = (tx.category_id as string) ?? (tx.category_name as string) ?? "unknown";
    const amount = Number((tx.amount as string | number) ?? 0);
    if (!byCat[cat]) byCat[cat] = { count: 0, sum: 0, negAbs: 0 };
    byCat[cat].count++;
    byCat[cat].sum += amount;
    if (amount < 0) byCat[cat].negAbs += -amount;
  }

  const categories = Object.entries(byCat)
    .map(([id, v]) => ({
      id,
      name: legend[id] || id,
      inCommission: allowed.has(id),
      count: v.count,
      sum: Math.round(v.sum * 100) / 100,
      negAbs: Math.round(v.negAbs * 100) / 100,
    }))
    .sort((a, b) => b.negAbs - a.negAbs);

  const parkCommission =
    Math.round(categories.filter((c) => c.inCommission).reduce((s, c) => s + c.negAbs, 0) * 100) / 100;

  return NextResponse.json({
    ok: true,
    driver: { id: driver.id, name: driver.fullName, yandexDriverId: driver.yandexDriverId },
    commissionCategoryIds: config.referral.commissionCategoryIds,
    parkCommission,
    categories,
  });
}
