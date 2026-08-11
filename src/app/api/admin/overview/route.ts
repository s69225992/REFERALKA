// Сводка для админки. Защищена ADMIN_TOKEN (заголовок Authorization: Bearer <token>).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

function authed(req: NextRequest): boolean {
  return !!config.adminToken && req.headers.get("authorization") === `Bearer ${config.adminToken}`;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [drivers, referrals, pending, paid] = await Promise.all([
    prisma.driver.count(),
    prisma.referral.count({ where: { active: true } }),
    prisma.referralAccrual.aggregate({ where: { status: "pending" }, _sum: { amount: true } }),
    prisma.referralAccrual.aggregate({ where: { status: "paid" }, _sum: { amount: true } }),
  ]);

  return NextResponse.json({
    drivers,
    activeReferrals: referrals,
    totalPending: (pending._sum.amount ?? 0).toString(),
    totalPaid: (paid._sum.amount ?? 0).toString(),
  });
}
