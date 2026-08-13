// Привязка Telegram-аккаунта к рефереру по его коду. Проверяем подпись initData,
// ищем реферера по коду (агент или водитель), создаём/обновляем accounts.telegram_id.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInitData } from "@/lib/telegram";
import { referrerCabinet, findReferrerByCode } from "@/lib/services/referrerData";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { initData, code } = (await req.json().catch(() => ({}))) as { initData?: string; code?: string };
  const v = verifyInitData(initData || "");
  if (!v.ok || !v.user) return NextResponse.json({ ok: false, error: v.error || "auth" }, { status: 401 });

  const ref = code ? await findReferrerByCode(code.trim().toUpperCase()) : null;
  if (!ref) return NextResponse.json({ ok: false, error: "Код не найден" }, { status: 404 });

  const telegramId = String(v.user.id);
  const data =
    ref.type === "agent"
      ? { telegramId, agentId: ref.id, role: "agent" }
      : { telegramId, driverId: ref.id, role: "driver" };

  await prisma.account.upsert({
    where: { telegramId },
    create: data,
    update: ref.type === "agent" ? { agentId: ref.id, role: "agent" } : { driverId: ref.id, role: "driver" },
  });

  const cabinet = await referrerCabinet(ref.type, ref.id);
  return NextResponse.json({ ok: true, linked: true, cabinet });
}
