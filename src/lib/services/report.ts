// Тестовый отчёт (без базы данных): по всем активным водителям парка считает
// комиссию парка за период и долю (1%/33%). Нужен, чтобы сверить цифры с реальным
// доходом парка ДО запуска полноценной рефералки.
//
// Логика: для каждого активного водителя тянем транзакции за период, группируем по
// категориям, суммируем "комиссию парка" (категории из PARK_COMMISSION_CATEGORY_IDS,
// берём модуль отрицательных сумм). Если категории не заданы — показываем ВСЕ, чтобы
// ты сам увидел, какая из них соответствует комиссии парка.
import { FleetClient } from "@/lib/fleet";
import { config } from "@/lib/config";

type Json = Record<string, unknown>;

// Точное представление денежной суммы в десятитысячных долях рубля (1/10000), целым.
// Fleet отдаёт amount строкой (обычно 4 знака после запятой). Складывать такие суммы
// в float опасно: накопленная ошибка изредка перекидывает копейку при округлении и
// даёт расхождение в 1 коп. с отчётом Fleet. Поэтому парсим точно и суммируем целыми.
export function amountToTenThousandths(v: unknown): number {
  if (typeof v === "number") return Math.round(v * 10000);
  let s = String(v ?? "").trim();
  if (!s) return 0;
  const neg = s.startsWith("-");
  if (neg || s.startsWith("+")) s = s.slice(1);
  const [ip, fpRaw = ""] = s.split(".");
  const intPart = parseInt(ip || "0", 10);
  if (Number.isNaN(intPart)) return Math.round((Number(v) || 0) * 10000);
  const fp = (fpRaw + "0000").slice(0, 4);
  const fracPart = parseInt(fp || "0", 10) || 0;
  const val = intPart * 10000 + fracPart;
  return neg ? -val : val;
}
// Десятитысячные → рубли, округление до копейки (как в сводке Fleet).
export function tenThousandthsToRub(tt: number): number {
  return Math.round(tt / 100) / 100; // 100 десятитысячных = 1 копейка
}

function isActive(profile: Json): boolean {
  const dp = (profile.driver_profile as Json) ?? profile;
  // work_status: "working" | "not_working" | "fired" (по докам Fleet API)
  const status = (dp.work_status as string) ?? "";
  return status !== "fired"; // считаем активными всех, кроме уволенных
}

function driverInfo(profile: Json) {
  const dp = (profile.driver_profile as Json) ?? profile;
  const name =
    [dp.last_name, dp.first_name, dp.middle_name].filter(Boolean).join(" ").trim() ||
    (dp.id as string);
  return { id: dp.id as string, name, workStatus: (dp.work_status as string) ?? "" };
}

export type DriverReportRow = {
  driverId: string;
  name: string;
  workStatus: string;
  parkCommission: number; // руб.
  referralShare: number; // руб. (parkCommission * rate)
  byCategory: Record<string, number>; // сумма по категориям (модуль, руб.)
};

export type TestReport = {
  period: { from: string; to: string };
  rate: number;
  commissionCategoryIds: string[];
  categoriesLegend: Record<string, string>;
  activeDrivers: number;
  totals: { parkCommission: number; referralShare: number };
  rows: DriverReportRow[];
};

export async function buildTestReport(from: string, to: string, client = new FleetClient()): Promise<TestReport> {
  const rate = config.referral.rate;
  const allowed = new Set(config.referral.commissionCategoryIds);

  // легенда категорий (id -> человекочитаемое имя)
  const legend: Record<string, string> = {};
  try {
    for (const c of await client.listTransactionCategories()) {
      if (c.id) legend[c.id as string] = (c.name as string) ?? (c.id as string);
    }
  } catch {
    // категории не критичны для теста — продолжаем без легенды
  }

  const profiles = await client.listDrivers();
  const active = profiles.filter(isActive);

  const rows: DriverReportRow[] = [];
  let totalCommission = 0;
  let totalShare = 0;

  for (const profile of active) {
    const { id, name, workStatus } = driverInfo(profile);
    if (!id) continue;

    const txs = await client.listDriverTransactions(id, from, to);
    const byCategory: Record<string, number> = {};
    let commissionTt = 0; // комиссия в десятитысячных (точное целочисленное суммирование)

    for (const tx of txs) {
      const category = (tx.category_id as string) ?? (tx.category_name as string) ?? "unknown";
      const amtTt = amountToTenThousandths((tx.amount as string | number) ?? 0);
      // Комиссия парка = НЕТТО по нужным категориям (сумма со знаком, включая
      // положительные корректировки/возвраты) — как в сводном отчёте Fleet.
      // Раньше суммировались только модули отрицательных, из-за чего разовые
      // возвраты внутри категории задваивали комиссию (расхождение в копейки/рубли).
      if (allowed.size > 0 && allowed.has(category)) commissionTt += amtTt;
      if (amtTt < 0) byCategory[category] = (byCategory[category] ?? 0) + -amtTt / 10000; // справочно
    }

    // Точное округление до копейки из целочисленной суммы — совпадает с Fleet.
    const commission = tenThousandthsToRub(Math.abs(commissionTt));
    const share = Math.round(commission * rate * 100) / 100;

    rows.push({ driverId: id, name, workStatus, parkCommission: commission, referralShare: share, byCategory });
    totalCommission += commission;
    totalShare += share;
  }

  rows.sort((a, b) => b.parkCommission - a.parkCommission);

  return {
    period: { from, to },
    rate,
    commissionCategoryIds: config.referral.commissionCategoryIds,
    categoriesLegend: legend,
    activeDrivers: active.length,
    totals: {
      parkCommission: Math.round(totalCommission * 100) / 100,
      referralShare: Math.round(totalShare * 100) / 100,
    },
    rows,
  };
}
