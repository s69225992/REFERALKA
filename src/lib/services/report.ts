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
    let commission = 0;

    for (const tx of txs) {
      const category = (tx.category_id as string) ?? (tx.category_name as string) ?? "unknown";
      const amount = Number((tx.amount as string | number) ?? 0);
      // Комиссия парка = НЕТТО по нужным категориям (сумма со знаком, включая
      // положительные корректировки/возвраты) — как в сводном отчёте Fleet.
      // Раньше суммировались только модули отрицательных, из-за чего разовые
      // возвраты внутри категории задваивали комиссию (расхождение в копейки/рубли).
      if (allowed.size > 0 && allowed.has(category)) commission += amount;
      if (amount < 0) byCategory[category] = (byCategory[category] ?? 0) + -amount; // справочно
    }

    commission = Math.round(Math.abs(commission) * 100) / 100;
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
