// Склад посуточной статистики водителей: заполнение дня из Fleet и агрегация периода из БД.
import { prisma } from "@/lib/prisma";
import { FleetClient } from "@/lib/fleet";
import { buildTestReport } from "@/lib/services/report";

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000; // таймзона парка (Москва, UTC+3, без летнего времени)

// Границы московских суток для даты YYYY-MM-DD, выраженные в UTC ISO.
export function mskDayWindow(dateStr: string) {
  const from = new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - MSK_OFFSET_MS).toISOString();
  const to = new Date(new Date(`${dateStr}T23:59:59.999Z`).getTime() - MSK_OFFSET_MS).toISOString();
  return { from, to };
}

// Сегодняшняя/прошлая московская дата (YYYY-MM-DD).
export function mskDateStr(daysAgo = 0): string {
  const d = new Date(Date.now() + MSK_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Заполнить/обновить статистику за один день (московские сутки) по всем водителям.
export async function syncDay(dateStr: string, final = true) {
  const client = new FleetClient();
  const { from, to } = mskDayWindow(dateStr);
  const [report, orders] = await Promise.all([
    buildTestReport(from, to, client),
    client.ordersByDriver(from, to),
  ]);
  const ordersByYid = (orders.byDriver ?? {}) as Record<string, number>;
  const commByYid: Record<string, number> = {};
  for (const r of report.rows) commByYid[r.driverId] = r.parkCommission;

  const drivers = await prisma.driver.findMany({ select: { id: true, yandexDriverId: true } });
  const idByYid = new Map<string, number>(
    drivers.map((d: { id: number; yandexDriverId: string }) => [d.yandexDriverId, d.id] as [string, number]),
  );

  const yids = new Set<string>([...Object.keys(ordersByYid), ...Object.keys(commByYid)]);
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  let written = 0;
  let unknown = 0;
  for (const yid of yids) {
    const driverId = idByYid.get(yid);
    if (!driverId) {
      unknown++; // водитель ещё не синкнут в БД — сначала запустить sync-drivers
      continue;
    }
    const ordersCount = ordersByYid[yid] ?? 0;
    const parkCommission = commByYid[yid] ?? 0;
    await prisma.driverDailyStat.upsert({
      where: { driverId_date: { driverId, date } },
      create: { driverId, date, orders: ordersCount, parkCommission, final },
      update: { orders: ordersCount, parkCommission, final, pulledAt: new Date() },
    });
    written++;
  }
  return { date: dateStr, from, to, written, unknown, driversInDb: drivers.length };
}

// Бэкфилл диапазона дат [fromDate..toDate] включительно (по московским суткам).
export async function syncRange(fromDate: string, toDate: string) {
  const results = [];
  let cur = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);
  for (; cur.getTime() <= end.getTime(); cur = new Date(cur.getTime() + 86400000)) {
    results.push(await syncDay(cur.toISOString().slice(0, 10)));
  }
  return results;
}

// Агрегация периода из склада: сумма заказов и комиссии по водителям за [fromDate..toDate].
export async function periodStats(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  return prisma.driverDailyStat.groupBy({
    by: ["driverId"],
    where: { date: { gte: from, lte: to } },
    _sum: { orders: true, parkCommission: true },
  });
}
