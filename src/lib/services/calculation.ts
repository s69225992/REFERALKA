// Расчёт реферальных начислений за период (с учётом тарифов).
// Для каждого активного реферала: комиссия парка -> доля агента по его тарифу
// (agent = комиссия × refRate/parkRate) -> запись начисления с идемпотентным ключом.
import { prisma } from "@/lib/prisma";
import { FleetClient } from "@/lib/fleet";
import { config } from "@/lib/config";
import { toCents, fromCents } from "@/lib/money";

function idemKey(refTag: string, referredId: number, from: string, to: string): string {
  return `ref_${refTag}_${referredId}_${from}_${to}`.replace(/[:+]/g, "");
}

// Сумма комиссии парка по водителю за период (комиссия = списание, берём модуль).
async function parkCommissionCents(
  client: FleetClient,
  yandexDriverId: string,
  from: string,
  to: string,
): Promise<number> {
  const allowed = new Set(config.referral.commissionCategoryIds);
  const txs = await client.listDriverTransactions(yandexDriverId, from, to);
  let cents = 0;
  for (const tx of txs) {
    const category = (tx.category_id as string) ?? (tx.category_name as string);
    if (allowed.size > 0 && !allowed.has(category)) continue;
    const amount = toCents((tx.amount as string | number) ?? 0);
    if (amount < 0) cents += -amount; // списание -> комиссия
  }
  return cents;
}

export async function calculatePeriod(from: string, to: string, client = new FleetClient()) {
  const minCents = toCents(config.referral.minPayout);
  let created = 0;
  let skipped = 0;

  // тарифы: code -> доля (refRate/parkRate)
  const tariffs = await prisma.tariff.findMany();
  const ratioByCode = new Map<string, number>();
  for (const t of tariffs) {
    const park = Number(t.parkRate);
    const ref = Number(t.refRate);
    ratioByCode.set(t.code, park > 0 ? ref / park : 0);
  }
  const defaultRatio = ratioByCode.get("3_1") ?? 1 / 3;

  const referrals = await prisma.referral.findMany({
    where: { active: true },
    include: { referred: true },
  });

  for (const ref of referrals) {
    const commissionCents = await parkCommissionCents(client, ref.referred.yandexDriverId, from, to);

    await prisma.commissionSnapshot.upsert({
      where: {
        referredId_periodFrom_periodTo: {
          referredId: ref.referredId,
          periodFrom: new Date(from),
          periodTo: new Date(to),
        },
      },
      create: {
        referredId: ref.referredId,
        periodFrom: new Date(from),
        periodTo: new Date(to),
        parkCommissionAmount: fromCents(commissionCents),
      },
      update: { parkCommissionAmount: fromCents(commissionCents) },
    });

    const ratio = ratioByCode.get(ref.tariffCode) ?? defaultRatio;
    const payoutCents = Math.round(commissionCents * ratio);
    // Реферер — водитель (d) или агент (a). Начисление считаем одинаково;
    // выплата (payout.ts) идёт только водителям, агентам — «только считаем».
    const refTag = ref.agentId != null ? `a${ref.agentId}` : `d${ref.referrerId}`;
    const key = idemKey(refTag, ref.referredId, from, to);

    const dup = await prisma.referralAccrual.findUnique({ where: { idempotencyKey: key } });
    if (dup || payoutCents < minCents) {
      skipped++;
      continue;
    }

    await prisma.referralAccrual.create({
      data: {
        referrerId: ref.referrerId ?? null,
        agentId: ref.agentId ?? null,
        referredId: ref.referredId,
        periodFrom: new Date(from),
        periodTo: new Date(to),
        baseAmount: fromCents(commissionCents),
        rate: ratio.toFixed(8),
        amount: fromCents(payoutCents),
        status: "pending",
        idempotencyKey: key,
      },
    });
    created++;
  }

  return { accrualsCreated: created, skipped, referralsProcessed: referrals.length };
}
