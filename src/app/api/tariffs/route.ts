import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const tariffs = await prisma.tariff.findMany({ where: { active: true }, orderBy: { sort: "asc" } });
  return NextResponse.json({
    tariffs: tariffs.map((t) => ({
      code: t.code,
      name: t.name,
      parkRate: Number(t.parkRate),
      refRate: Number(t.refRate),
    })),
  });
}
