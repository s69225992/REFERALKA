// Служебный разбор транзакций водителя по категориям за период — для сверки комиссии
// с отчётом Fleet. ?driverId=<id в нашей БД>&from=..&to=.. (сессионная авторизация).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";
import { config } from "@/lib/config";
import { FleetClient } from "@/lib/fleet";
import { amountToTenThousandths, tenThousandthsToRub } from "@/lib/services/report";

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

  // Сверка методов расчёта НЕТТО по категориям комиссии (как в отчёте):
  //  - exact: целочисленное суммирование десятитысячных → округление до копейки (совпадает с Fleet)
  //  - float: старое суммирование в плавающей точке (могло давать ±1 коп.)
  let commTt = 0;
  let commFloat = 0;
  const commAmountsRaw: string[] = [];
  let sumRoundEachKop = 0; // сумма (в копейках) round(каждой транзакции до копейки)
  let sumTruncEachKop = 0; // сумма (в копейках) trunc(каждой транзакции до копейки)
  for (const tx of txs) {
    const cat = (tx.category_id as string) ?? (tx.category_name as string) ?? "unknown";
    if (!allowed.has(cat)) continue;
    const tt = amountToTenThousandths((tx.amount as string | number) ?? 0);
    commTt += tt;
    commFloat += Number((tx.amount as string | number) ?? 0);
    commAmountsRaw.push(String((tx.amount as string | number) ?? ""));
    sumRoundEachKop += Math.round(tt / 100); // ten-thousandths → копейки, округление каждой
    sumTruncEachKop += Math.trunc(tt / 100); // ten-thousandths → копейки, усечение каждой
  }
  // Кандидаты для сверки с Fleet (по абсолютной величине НЕТТО):
  const absTt = Math.abs(commTt);
  const roundTotal = Math.round(absTt / 100) / 100; // текущий (округление итога)
  const truncTotal = Math.trunc(absTt / 100) / 100; // усечение итога
  const roundEach = Math.abs(sumRoundEachKop) / 100; // округление каждой транзакции, затем сумма
  const truncEach = Math.abs(sumTruncEachKop) / 100; // усечение каждой транзакции, затем сумма
  const parkCommissionExact = roundTotal;
  const parkCommissionFloat = Math.round(Math.abs(commFloat) * 100) / 100;

  return NextResponse.json({
    ok: true,
    driver: { id: driver.id, name: driver.fullName, yandexDriverId: driver.yandexDriverId },
    commissionCategoryIds: config.referral.commissionCategoryIds,
    parkCommission,
    parkCommissionExact,
    parkCommissionFloat,
    diffKop: Math.round((parkCommissionExact - parkCommissionFloat) * 100),
    commTenThousandths: commTt,
    candidates: { roundTotal, truncTotal, roundEach, truncEach },
    commAmountsRaw,
    categories,
  });
}
