// Привязать реферера к водителю по коду реферера.
// Реферер может быть водителем (Driver) или агентом (Agent) — ищем код в обоих.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { referralCode, tariffCode } = (await req.json().catch(() => ({}))) as {
    referralCode?: string;
    tariffCode?: string;
  };
  if (!referralCode) return NextResponse.json({ error: "referralCode required" }, { status: 400 });

  const driverId = Number(params.id);
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) return NextResponse.json({ error: "driver not found" }, { status: 404 });

  // Уже привязан? (один реферер на приведённого — referredId уникален)
  const existing = await prisma.referral.findUnique({ where: { referredId: driverId } });
  if (existing) return NextResponse.json({ error: "referrer already set" }, { status: 409 });

  // Тариф: берём переданный (если валиден), иначе базовый.
  let code = "3_1";
  if (tariffCode) {
    const t = await prisma.tariff.findUnique({ where: { code: tariffCode } });
    if (t) code = t.code;
  }

  // Ищем реферера по коду: сначала среди водителей, затем среди агентов.
  const driverReferrer = await prisma.driver.findUnique({ where: { referralCode } });
  if (driverReferrer) {
    if (driverReferrer.id === driver.id)
      return NextResponse.json({ error: "cannot refer yourself" }, { status: 400 });
    await prisma.driver.update({ where: { id: driver.id }, data: { referredBy: driverReferrer.id } });
    await prisma.referral.create({
      data: { referrerId: driverReferrer.id, referredId: driver.id, tariffCode: code },
    });
    return NextResponse.json({
      ok: true,
      referrerType: "driver",
      referrerId: driverReferrer.id,
      tariffCode: code,
    });
  }

  const agentReferrer = await prisma.agent.findUnique({ where: { referralCode } });
  if (agentReferrer) {
    await prisma.referral.create({
      data: { agentId: agentReferrer.id, referredId: driver.id, tariffCode: code },
    });
    return NextResponse.json({
      ok: true,
      referrerType: "agent",
      agentId: agentReferrer.id,
      tariffCode: code,
    });
  }

  return NextResponse.json({ error: "referral code not found" }, { status: 404 });
}
