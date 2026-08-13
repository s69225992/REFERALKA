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

// Любую дату/ISO приводим к московской дате YYYY-MM-DD (кабинет шлёт ...+03:00 — берём как есть).
export function mskDateFromAny(s: string): string {
  const t = new Date(s);
  if (isNaN(t.getTime())) return mskDateStr(0);
  return new Date(t.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

// Сколько последних дней тянуть живьём (остальное — из склада). Старше — «закрытые» дни.
const LIVE_RECENT_DAYS = Number(process.env.LIVE_RECENT_DAYS ?? 4);

// Склейка периода: старые дни берём из склада, последние LIVE_RECENT_DAYS — живьём из Fleet.
// opts выбирает, что тянуть живьём: {commission} для отчёта, {orders} для счётчика заказов
// (склад всегда содержит и то и другое; живой вызов делаем только для нужного).
export async function hybridPeriod(
  fromDate: string,
  toDate: string,
  opts: { commission?: boolean; orders?: boolean } = {},
) {
  const recentFrom = mskDateStr(LIVE_RECENT_DAYS - 1); // первый «живой» день (напр. 3 дня назад)
  const storedTo = mskDateStr(LIVE_RECENT_DAYS); // последний «закрытый» день (напр. 4 дня назад)

  const storedToEff = toDate < storedTo ? toDate : storedTo;
  const useStored = fromDate <= storedToEff;
  const liveFromEff = fromDate > recentFrom ? fromDate : recentFrom;
  const useLive = liveFromEff <= toDate;

  type Acc = { name: string; parkCommission: number; orders: number };
  const acc = new Map<string, Acc>();
  const ensure = (yid: string): Acc => {
    let e = acc.get(yid);
    if (!e) {
      e = { name: "", parkCommission: 0, orders: 0 };
      acc.set(yid, e);
    }
    return e;
  };

  // --- старая часть: из склада ---
  if (useStored) {
    const rows = await periodStats(fromDate, storedToEff);
    const drivers = await prisma.driver.findMany({
      select: { id: true, yandexDriverId: true, fullName: true },
    });
    const meta = new Map<number, { yandexDriverId: string; fullName: string | null }>(
      drivers.map((d: { id: number; yandexDriverId: string; fullName: string | null }) => [
        d.id,
        { yandexDriverId: d.yandexDriverId, fullName: d.fullName },
      ]),
    );
    for (const r of rows as Array<{ driverId: number; _sum: { parkCommission: number | null; orders: number | null } }>) {
      const m = meta.get(r.driverId);
      if (!m) continue;
      const e = ensure(m.yandexDriverId);
      e.name = m.fullName || e.name;
      e.parkCommission += Number(r._sum.parkCommission || 0);
      e.orders += Number(r._sum.orders || 0);
    }
  }

  // --- свежая часть: живьём из Fleet ---
  if (useLive) {
    const client = new FleetClient();
    const winFrom = mskDayWindow(liveFromEff).from;
    const winTo = mskDayWindow(toDate).to;
    const [report, orders] = await Promise.all([
      opts.commission ? buildTestReport(winFrom, winTo, client) : Promise.resolve(null),
      opts.orders ? client.ordersByDriver(winFrom, winTo) : Promise.resolve(null),
    ]);
    if (report) {
      for (const r of report.rows) {
        const e = ensure(r.driverId);
        e.name = e.name || r.name;
        e.parkCommission += r.parkCommission;
      }
    }
    if (orders) {
      const bd = (orders.byDriver ?? {}) as Record<string, number>;
      for (const [yid, c] of Object.entries(bd)) {
        ensure(yid).orders += Number(c) || 0;
      }
    }
  }

  return {
    acc,
    split: {
      stored: useStored ? { from: fromDate, to: storedToEff } : null,
      live: useLive ? { from: liveFromEff, to: toDate } : null,
    },
  };
}
