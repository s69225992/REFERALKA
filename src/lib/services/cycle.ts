// Полный цикл: синхронизация -> расчёт -> выплата.
import { FleetClient } from "@/lib/fleet";
import { syncDrivers } from "@/lib/services/sync";
import { calculatePeriod } from "@/lib/services/calculation";
import { payPending } from "@/lib/services/payout";

export async function runCycle(from: string, to: string) {
  const client = new FleetClient();
  const sync = await syncDrivers(client);
  const calc = await calculatePeriod(from, to, client);
  const payout = await payPending(client);
  return { period: { from, to }, sync, calc, payout };
}

// Прошедшая неделя (пн..пн), в UTC. Vercel Cron работает в UTC.
export async function runWeeklyCycle() {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 7);
  return runCycle(from.toISOString(), to.toISOString());
}
