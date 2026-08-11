import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const driver = await prisma.driver.findUnique({ where: { id: Number(params.id) } });
  if (!driver) return NextResponse.json({ error: "driver not found" }, { status: 404 });
  return NextResponse.json({
    referralCode: driver.referralCode,
    shareLink: `https://your-app.example/invite/${driver.referralCode}`,
  });
}
