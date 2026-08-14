// Данные кабинета реферера (агент или водитель-реферер): профиль, приведённые, начисления.
// Используется Telegram Mini App и «просмотром как» менеджера.
import { prisma } from "@/lib/prisma";

export async function referrerCabinet(type: "agent" | "driver", id: number) {
  const where = type === "agent" ? { agentId: id } : { referrerId: id };

  const [referrals, accruals] = await Promise.all([
    prisma.referral.findMany({
      where,
      include: { referred: { select: { id: true, fullName: true, referralCode: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.referralAccrual.findMany({ where, orderBy: { periodTo: "desc" }, take: 100 }),
  ]);

  let profile:
    | { type: "agent" | "driver"; id: number; name: string | null; code: string; phone: string | null; photoUrl: string | null }
    | null = null;
  if (type === "agent") {
    const a = await prisma.agent.findUnique({ where: { id } });
    if (!a) return null;
    profile = { type, id: a.id, name: a.fullName, code: a.referralCode, phone: a.phone, photoUrl: a.photoUrl };
  } else {
    const d = await prisma.driver.findUnique({ where: { id } });
    if (!d) return null;
    profile = { type, id: d.id, name: d.fullName, code: d.referralCode, phone: d.phone, photoUrl: d.photoUrl };
  }

  const accrued = accruals.reduce((s: number, a: any) => s + Number(a.amount), 0);
  return {
    referrer: profile,
    referred: referrals.map((r: any) => ({
      name: r.referred.fullName,
      code: r.referred.referralCode,
      tariffCode: r.tariffCode,
      qualifyingOrders: r.qualifyingOrders,
      activatedAt: r.activatedAt,
    })),
    accruals: accruals.map((a: any) => ({
      periodFrom: a.periodFrom,
      periodTo: a.periodTo,
      amount: a.amount.toString(),
      status: a.status,
    })),
    totals: {
      referredTotal: referrals.length,
      referredActive: referrals.filter((r: any) => r.activatedAt).length,
      accrued,
    },
  };
}

// Кабинет + данные уровня аккаунта (выводы, доступный баланс, принятие оферты).
// Используется мини-аппом, где важно показать балансы и историю выплат конкретной учётки.
export async function referrerCabinetForAccount(account: {
  id: number;
  agentId: number | null;
  driverId: number | null;
  ofertaAcceptedAt?: Date | null;
}) {
  const type: "agent" | "driver" = account.agentId ? "agent" : "driver";
  const id = account.agentId || account.driverId;
  if (!id) return null;
  const cabinet = await referrerCabinet(type, id);
  if (!cabinet) return null;

  // Выплаты — «неломающие»: если таблицы ещё нет или запрос завис, кабинет всё равно грузится.
  let withdrawals: any[] = [];
  try {
    withdrawals = (await Promise.race([
      prisma.withdrawal.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } }),
      new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 5000)),
    ])) as any[];
  } catch {
    withdrawals = [];
  }

  // Оферта — тоже «неломающе»: если колонки ещё нет в БД, отдаём null.
  let ofertaAcceptedAt: string | null = account.ofertaAcceptedAt ? account.ofertaAcceptedAt.toISOString() : null;
  if (account.ofertaAcceptedAt === undefined) {
    try {
      const a = await prisma.account.findUnique({ where: { id: account.id }, select: { ofertaAcceptedAt: true } });
      ofertaAcceptedAt = a?.ofertaAcceptedAt ? a.ofertaAcceptedAt.toISOString() : null;
    } catch {
      ofertaAcceptedAt = null;
    }
  }

  const earned = Number(cabinet.totals.accrued || 0);
  const reserved = withdrawals
    .filter((w: any) => w.status !== "rejected")
    .reduce((s: number, w: any) => s + Number(w.amount), 0);
  const available = Math.max(0, Math.round((earned - reserved) * 100) / 100);

  return {
    ...cabinet,
    available,
    ofertaAcceptedAt,
    withdrawals: withdrawals.map((w: any) => ({
      id: w.id,
      amount: w.amount.toString(),
      status: w.status,
      createdAt: w.createdAt,
      decidedAt: w.decidedAt,
    })),
  };
}

// Найти реферера по коду: сначала среди агентов, затем среди водителей-рефереров.
export async function findReferrerByCode(code: string) {
  const agent = await prisma.agent.findUnique({ where: { referralCode: code } });
  if (agent) return { type: "agent" as const, id: agent.id };
  const driver = await prisma.driver.findUnique({ where: { referralCode: code } });
  if (driver) return { type: "driver" as const, id: driver.id };
  return null;
}
