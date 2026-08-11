// Акцепт оферты реферером (агентом).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const driver = await prisma.driver.findUnique({ where: { id: Number(params.id) } });
  if (!driver) return NextResponse.json({ error: "driver not found" }, { status: 404 });
  const updated = await prisma.driver.update({
    where: { id: driver.id },
    data: { ofertaAcceptedAt: new Date() },
  });
  return NextResponse.json({ ok: true, acceptedAt: updated.ofertaAcceptedAt });
}
