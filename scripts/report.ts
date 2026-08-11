// Локальный тестовый отчёт БЕЗ базы данных — самый быстрый способ увидеть цифры.
//   npx tsx scripts/report.ts                        # прошедшие 7 дней
//   npx tsx scripts/report.ts 2026-08-01 2026-08-08  # период
//   npx tsx scripts/report.ts --categories           # показать категории транзакций
//
// Нужны только переменные Fleet API в .env (FLEET_CLIENT_ID/API_KEY/PARK_ID).
// База (DATABASE_URL) для этого отчёта НЕ требуется.
import "dotenv/config";
import { FleetClient } from "../src/lib/fleet";
import { buildTestReport } from "../src/lib/services/report";

function rub(n: number): string {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--categories")) {
    const client = new FleetClient();
    console.log("Категории транзакций (id — название):");
    for (const c of await client.listTransactionCategories()) console.log(" ", c.id, "—", c.name);
    return;
  }

  const pos = args.filter((a) => !a.startsWith("--"));
  let from: string, to: string;
  if (pos.length === 2) {
    [from, to] = pos;
  } else {
    const t = new Date();
    t.setUTCHours(0, 0, 0, 0);
    const f = new Date(t);
    f.setUTCDate(f.getUTCDate() - 7);
    from = f.toISOString();
    to = t.toISOString();
  }

  const r = await buildTestReport(from, to);

  console.log(`\nПериод: ${from} — ${to}`);
  console.log(`Активных водителей: ${r.activeDrivers}`);
  console.log(`Доля реферера (rate): ${(r.rate * 100).toFixed(2)}%`);
  if (r.commissionCategoryIds.length === 0) {
    console.log(
      "\n⚠ PARK_COMMISSION_CATEGORY_IDS не задан — комиссия парка = 0. Ниже разбивка по всем\n" +
      "  категориям (модуль списаний) по каждому водителю. Найди категорию комиссии парка,\n" +
      "  впиши её id в .env и запусти снова.",
    );
  }

  console.log("\nПо водителям (сортировка по комиссии парка):");
  for (const row of r.rows) {
    console.log(
      `  ${row.name.padEnd(28)} комиссия парка: ${rub(row.parkCommission).padStart(12)} ₽   1%-доля: ${rub(row.referralShare).padStart(10)} ₽`,
    );
    if (r.commissionCategoryIds.length === 0) {
      for (const [cat, sum] of Object.entries(row.byCategory)) {
        const label = r.categoriesLegend[cat] ?? cat;
        console.log(`        • ${label} (${cat}): ${rub(sum)} ₽`);
      }
    }
  }

  console.log("\n=== ИТОГО ===");
  console.log(`Комиссия парка (все активные): ${rub(r.totals.parkCommission)} ₽   <- сверь со своим доходом парка`);
  console.log(`Доля рефереров (${(r.rate * 100).toFixed(2)}%):        ${rub(r.totals.referralShare)} ₽`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
