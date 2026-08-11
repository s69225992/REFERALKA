// Сид базовых тарифов. Запуск: npx tsx scripts/seed.ts
import { prisma } from "../src/lib/prisma";

const TARIFFS = [
  { code: "3_1", name: "3 / 1", parkRate: "3.000", refRate: "1.000", sort: 1 },
  { code: "4_1.5", name: "4 / 1,5", parkRate: "4.000", refRate: "1.500", sort: 2 },
  { code: "5_2", name: "5 / 2", parkRate: "5.000", refRate: "2.000", sort: 3 },
];

async function main() {
  for (const t of TARIFFS) {
    await prisma.tariff.upsert({
      where: { code: t.code },
      create: t,
      update: { name: t.name, parkRate: t.parkRate, refRate: t.refRate, sort: t.sort },
    });
  }
  console.log("Тарифы засеяны:", TARIFFS.map((t) => t.code).join(", "));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
