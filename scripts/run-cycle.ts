// Ручной прогон цикла из терминала (для теста).
//   npx tsx scripts/run-cycle.ts                        # прошедшая неделя
//   npx tsx scripts/run-cycle.ts 2026-08-01 2026-08-08  # период
//   npx tsx scripts/run-cycle.ts --categories           # показать категории транзакций
import "dotenv/config";
import { runCycle, runWeeklyCycle } from "../src/lib/services/cycle";
import { FleetClient } from "../src/lib/fleet";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--categories")) {
    const client = new FleetClient();
    const cats = await client.listTransactionCategories();
    for (const c of cats) console.log(c.id, "—", c.name);
    return;
  }

  const pos = args.filter((a) => !a.startsWith("--"));
  const result = pos.length === 2 ? await runCycle(pos[0], pos[1]) : await runWeeklyCycle();
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
