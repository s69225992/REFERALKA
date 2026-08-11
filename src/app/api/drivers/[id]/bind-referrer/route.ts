// Привязать реферера по его коду (при подключении нового водителя).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { referralCode, tariffCode } = (await req.json().catch(() => ({}))) as {
    referralCode?: string;
    tariffCode?: string;
  };
  if (!referralCode) return NextResponse.json({ error: "referralCode required" }, { status: 400 });

  const driver = await prisma.driver.findUnique({ where: { id: Number(params.id) } });
  if (!driver) return NextResponse.json({ error: "driver not found" }, { status: 404 });
  if (driver.referredBy) return NextResponse.json({ error: "referrer already set" }, { status: 409 });

  const referrer = await prisma.driver.findUnique({ where: { referralCode } });
  if (!referrer) return NextResponse.json({ error: "referral code not found" }, { status: 404 });
  if (referrer.id === driver.id)
    return NextResponse.json({ error: "cannot refer yourself" }, { status: 400 });

  // тариф: берём переданный, иначе базовый 3_1
  let code = "3_1";
  if (tariffCode) {
    const t = await prisma.tariff.findUnique({ where: { code: tariffCode } });
    if (t) code = t.code;
  }

  await prisma.driver.update({ where: { id: driver.id }, data: { referredBy: referrer.id } });
  await prisma.referral.create({
    data: { referrerId: referrer.id, referredId: driver.id, tariffCode: code },
  });
  return NextResponse.json({ ok: true, referrerId: referrer.id, tariffCode: code });
}
