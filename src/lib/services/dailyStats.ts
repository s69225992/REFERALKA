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

// Дни в диапазоне [fromDate..toDate], для которых в складе НЕТ ни одной записи (пропуски).
export async function missingDays(fromDate: string, toDate: string): Promise<string[]> {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const rows = await prisma.driverDailyStat.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
    distinct: ["date"],
  });
  const present = new Set(rows.map((r: { date: Date }) => r.date.toISOString().slice(0, 10)));
  const missing: string[] = [];
  for (let d = new Date(from); d.getTime() <= to.getTime(); d = new Date(d.getTime() + 86400000)) {
    const s = d.toISOString().slice(0, 10);
    if (!present.has(s)) missing.push(s);
  }
  return missing;
}

// Любую дату/ISO приводим к московской дате YYYY-MM-DD (кабинет шлёт ...+03:00 — берём как есть).
export function mskDateFromAny(s: string): string {
  const t = new Date(s);
  if (isNaN(t.getTime())) return mskDateStr(0);
  return new Date(t.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

// Сколько последних дней держим «свежими» в складе (сегодня/вчера меняются).
const LIVE_RECENT_DAYS = Number(process.env.LIVE_RECENT_DAYS ?? 4);
// Сколько последних дней освежать на чтении дашборда (обычно хватает сегодня+вчера).
const REFRESH_RECENT_DAYS = Number(process.env.REFRESH_RECENT_DAYS ?? 2);
// TTL кэша свежих дней: день перетягиваем из Fleet не чаще, чем раз в это время.
const RECENT_CACHE_TTL_MS = Number(process.env.RECENT_CACHE_TTL_MS ?? 3 * 60 * 60 * 1000); // 3 часа

// Освежить последние дни в складе, если данные устарели (> TTL) или их ещё нет.
// Тяжёлый вызов к Fleet делается максимум раз в TTL на день — поэтому вход в кабинет быстрый:
// в пределах 3 часов Обзор читается из склада мгновенно, без запросов к Fleet.
export async function ensureRecentFresh(days = REFRESH_RECENT_DAYS): Promise<string[]> {
  const now = Date.now();
  const refreshed: string[] = [];
  for (let d = 0; d < days; d++) {
    const ds = mskDateStr(d);
    const dateObj = new Date(`${ds}T00:00:00.000Z`);
    const agg = await prisma.driverDailyStat.aggregate({
      where: { date: dateObj },
      _max: { pulledAt: true },
      _count: { _all: true },
    });
    const last = agg._max.pulledAt ? new Date(agg._max.pulledAt).getTime() : 0;
    const fresh = (agg._count._all ?? 0) > 0 && now - last < RECENT_CACHE_TTL_MS;
    if (!fresh) {
      try {
        await syncDay(ds, false); // final=false — окончательно закроется ночным cron через пару дней
        refreshed.push(ds);
      } catch {
        /* не роняем дашборд, если Fleet недоступен — покажем что есть в складе */
      }
    }
  }
  return refreshed;
}

// Период для дашборда: держим свежие дни в складе (TTL 3ч) и читаем ВЕСЬ период из склада.
// К Fleet на каждом открытии больше не ходим — только когда истёк TTL по конкретному дню.
// opts оставлен для совместимости вызовов (склад всегда содержит и заказы, и комиссию).
export async function hybridPeriod(
  fromDate: string,
  toDate: string,
  _opts: { commission?: boolean; orders?: boolean } = {},
) {
  const refreshed = await ensureRecentFresh();

  type Acc = { name: string; parkCommission: number; orders: number };
  const acc = new Map<string, Acc>();

  const rows = await periodStats(fromDate, toDate);
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
    acc.set(m.yandexDriverId, {
      name: m.fullName || "",
      parkCommission: Number(r._sum.parkCommission || 0),
      orders: Number(r._sum.orders || 0),
    });
  }

  return { acc, split: { stored: { from: fromDate, to: toDate }, live: null, refreshed } };
}
