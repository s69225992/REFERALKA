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

// Найти реферера по коду: сначала среди агентов, затем среди водителей-рефереров.
export async function findReferrerByCode(code: string) {
  const agent = await prisma.agent.findUnique({ where: { referralCode: code } });
  if (agent) return { type: "agent" as const, id: agent.id };
  const driver = await prisma.driver.findUnique({ where: { referralCode: code } });
  if (driver) return { type: "driver" as const, id: driver.id };
  return null;
}
