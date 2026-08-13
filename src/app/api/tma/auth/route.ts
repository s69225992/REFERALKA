// Вход в Telegram Mini App: проверяем подпись initData, ищем привязку аккаунта
// (accounts.telegram_id) к рефереру. Если привязан — отдаём кабинет; если нет — просим код.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInitData, tgDisplayName } from "@/lib/telegram";
import { referrerCabinet } from "@/lib/services/referrerData";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { initData } = (await req.json().catch(() => ({}))) as { initData?: string };
  const v = verifyInitData(initData || "");
  if (!v.ok || !v.user) return NextResponse.json({ ok: false, error: v.error || "auth" }, { status: 401 });

  const tgName = tgDisplayName(v.user);
  const account = await prisma.account.findUnique({ where: { telegramId: String(v.user.id) } });

  if (account?.agentId) {
    const cabinet = await referrerCabinet("agent", account.agentId);
    return NextResponse.json({ ok: true, linked: true, tgName, cabinet });
  }
  if (account?.driverId) {
    const cabinet = await referrerCabinet("driver", account.driverId);
    return NextResponse.json({ ok: true, linked: true, tgName, cabinet });
  }
  // не привязан — фронт покажет ввод кода
  return NextResponse.json({ ok: true, linked: false, tgName });
}
