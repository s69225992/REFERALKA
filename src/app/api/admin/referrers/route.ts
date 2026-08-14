// Единый список рефереров (агенты + водители-рефереры) со статусом «зашёл в бот или нет».
// linked=true — есть привязанный Telegram-аккаунт (человек зарегистрировался в боте).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [agents, drivers, accounts, refA, actA, accAcc, refD, actD, accDacc] = await Promise.all([
    prisma.agent.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.driver.findMany({ select: { id: true, fullName: true, phone: true, referralCode: true, createdAt: true } }),
    prisma.account.findMany({
      where: { OR: [{ agentId: { not: null } }, { driverId: { not: null } }] },
      select: { agentId: true, driverId: true, createdAt: true },
    }),
    prisma.referral.groupBy({ by: ["agentId"], where: { agentId: { not: null } }, _count: true }),
    prisma.referral.groupBy({ by: ["agentId"], where: { agentId: { not: null }, activatedAt: { not: null } }, _count: true }),
    prisma.referralAccrual.groupBy({ by: ["agentId"], where: { agentId: { not: null } }, _sum: { amount: true } }),
    prisma.referral.groupBy({ by: ["referrerId"], where: { referrerId: { not: null } }, _count: true }),
    prisma.referral.groupBy({ by: ["referrerId"], where: { referrerId: { not: null }, activatedAt: { not: null } }, _count: true }),
    prisma.referralAccrual.groupBy({ by: ["referrerId"], where: { referrerId: { not: null } }, _sum: { amount: true } }),
  ]);

  const accByAgent = new Map<number, Date>();
  const accByDriver = new Map<number, Date>();
  for (const a of accounts as any[]) {
    if (a.agentId) accByAgent.set(a.agentId, a.createdAt);
    if (a.driverId) accByDriver.set(a.driverId, a.createdAt);
  }
  const toMap = (agg: any[], key: string, val: (r: any) => number) => new Map<number, number>(agg.map((r: any) => [r[key], val(r)]));
  const refAm = toMap(refA, "agentId", (r) => r._count);
  const actAm = toMap(actA, "agentId", (r) => r._count);
  const accAm = toMap(accAcc, "agentId", (r) => Number(r._sum.amount ?? 0));
  const refDm = toMap(refD, "referrerId", (r) => r._count);
  const actDm = toMap(actD, "referrerId", (r) => r._count);
  const accDm = toMap(accDacc, "referrerId", (r) => Number(r._sum.amount ?? 0));

  const agentRows = (agents as any[]).map((a) => ({
    type: "agent",
    id: a.id,
    fullName: a.fullName,
    phone: a.phone,
    code: a.referralCode,
    birthDate: a.birthDate,
    createdAt: a.createdAt,
    device: a.regDevice,
    region: a.regRegion,
    linked: accByAgent.has(a.id),
    linkedAt: accByAgent.get(a.id) || null,
    referredTotal: refAm.get(a.id) ?? 0,
    referredActive: actAm.get(a.id) ?? 0,
    accrued: accAm.get(a.id) ?? 0,
  }));

  // Водитель-реферер = у кого есть приведённые ИЛИ привязан бот-аккаунт как водитель
  const drvIds = new Set<number>();
  for (const r of refD as any[]) if (r.referrerId) drvIds.add(r.referrerId);
  for (const id of accByDriver.keys()) drvIds.add(id);
  const driverRows = (drivers as any[])
    .filter((d) => drvIds.has(d.id))
    .map((d) => ({
      type: "driver",
      id: d.id,
      fullName: d.fullName,
      phone: d.phone,
      code: d.referralCode,
      birthDate: null,
      createdAt: d.createdAt,
      device: null,
      region: null,
      linked: accByDriver.has(d.id),
      linkedAt: accByDriver.get(d.id) || null,
      referredTotal: refDm.get(d.id) ?? 0,
      referredActive: actDm.get(d.id) ?? 0,
      accrued: accDm.get(d.id) ?? 0,
    }));

  return NextResponse.json({ ok: true, referrers: [...agentRows, ...driverRows] });
}
