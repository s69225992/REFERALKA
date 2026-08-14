// Принятие оферты реферером в мини-аппе. Пишем метку времени в accounts.oferta_accepted_at.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInitData } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { initData } = (await req.json().catch(() => ({}))) as { initData?: string };
  const v = verifyInitData(initData || "");
  if (!v.ok || !v.user) return NextResponse.json({ ok: false, error: v.error || "auth" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { telegramId: String(v.user.id) } });
  if (!account || (!account.agentId && !account.driverId)) {
    return NextResponse.json({ ok: false, error: "Кабинет не привязан" }, { status: 403 });
  }
  const acceptedAt = account.ofertaAcceptedAt || new Date();
  if (!account.ofertaAcceptedAt) {
    await prisma.account.update({ where: { id: account.id }, data: { ofertaAcceptedAt: acceptedAt } });
  }
  return NextResponse.json({ ok: true, ofertaAcceptedAt: acceptedAt.toISOString() });
}
