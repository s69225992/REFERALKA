import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const accruals = await prisma.referralAccrual.findMany({
    where: { referrerId: Number(params.id) },
    orderBy: { periodTo: "desc" },
  });
  const sum = (status: string) =>
    accruals.filter((a) => a.status === status).reduce((acc, a) => acc + Number(a.amount), 0);
  return NextResponse.json({
    totalPaid: sum("paid").toFixed(2),
    totalPending: sum("pending").toFixed(2),
    history: accruals.map((a) => ({
      periodFrom: a.periodFrom,
      periodTo: a.periodTo,
      baseAmount: a.baseAmount.toString(),
      amount: a.amount.toString(),
      status: a.status,
    })),
  });
}
