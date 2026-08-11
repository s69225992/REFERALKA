import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const refs = await prisma.referral.findMany({
    where: { referrerId: Number(params.id), active: true },
    include: { referred: true },
  });
  return NextResponse.json({
    count: refs.length,
    referrals: refs.map((r) => ({
      driverId: r.referred.id,
      name: r.referred.fullName,
      status: r.referred.status,
      joinedAt: r.referred.joinedAt,
    })),
  });
}
