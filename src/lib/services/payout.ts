// Выплата pending-начислений через Fleet API.
// Двойная защита от дублей: idempotencyKey в нашей БД + X-Idempotency-Token у Яндекса.
import { prisma } from "@/lib/prisma";
import { FleetClient } from "@/lib/fleet";
import { config } from "@/lib/config";

export async function payPending(client = new FleetClient(), limit = 500) {
  let paid = 0;
  let failed = 0;

  const pending = await prisma.referralAccrual.findMany({
    where: { status: "pending" },
    take: limit,
    include: { referrer: true },
  });

  for (const accrual of pending) {
    const description = `Агентское вознаграждение (реферальная программа) за период ${accrual.periodFrom.toISOString()}—${accrual.periodTo.toISOString()}`;
    const reqPayload = {
      driver_id: accrual.referrer.yandexDriverId,
      amount: accrual.amount.toString(),
      category_id: config.referral.payoutCategoryId,
      description,
      idempotency_key: accrual.idempotencyKey,
    };
    try {
      const resp = await client.createTransaction({
        driverId: accrual.referrer.yandexDriverId,
        amount: accrual.amount.toString(),
        categoryId: config.referral.payoutCategoryId,
        description,
        idempotencyKey: accrual.idempotencyKey,
      });
      const tx = (resp.transaction as Record<string, unknown>) ?? resp;
      await prisma.referralAccrual.update({
        where: { id: accrual.id },
        data: { status: "paid", yandexTxId: (tx.id as string) ?? null },
      });
      await prisma.payoutLog.create({
        data: { accrualId: accrual.id, request: JSON.stringify(reqPayload), response: JSON.stringify(resp) },
      });
      paid++;
    } catch (e) {
      await prisma.referralAccrual.update({ where: { id: accrual.id }, data: { status: "failed" } });
      await prisma.payoutLog.create({
        data: { accrualId: accrual.id, request: JSON.stringify(reqPayload), response: `ERROR: ${String(e)}` },
      });
      failed++;
    }
  }

  return { paid, failed };
}
