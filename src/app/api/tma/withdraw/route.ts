// Запрос реферера на вывод доступного баланса. Создаёт Withdrawal(status=requested)
// на всю доступную сумму (заработано минус уже запрошенные/выплаченные). Подтверждает менеджер.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInitData } from "@/lib/telegram";
import { referrerCabinetForAccount } from "@/lib/services/referrerData";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { initData } = (await req.json().catch(() => ({}))) as { initData?: string };
  const v = verifyInitData(initData || "");
  if (!v.ok || !v.user) return NextResponse.json({ ok: false, error: v.error || "auth" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { telegramId: String(v.user.id) } });
  if (!account || (!account.agentId && !account.driverId)) {
    return NextResponse.json({ ok: false, error: "Кабинет не привязан" }, { status: 403 });
  }

  // не даём создать второй активный запрос
  const activeReq = await prisma.withdrawal.findFirst({
    where: { accountId: account.id, status: { in: ["requested", "processing"] } },
  });
  if (activeReq) {
    const cabinet = await referrerCabinetForAccount(account);
    return NextResponse.json({ ok: true, cabinet, already: true });
  }

  const cab = await referrerCabinetForAccount(account);
  const available = Number(cab?.available || 0);
  if (available <= 0) {
    return NextResponse.json({ ok: false, error: "Нет средств к выводу" }, { status: 400 });
  }

  await prisma.withdrawal.create({
    data: { accountId: account.id, amount: available, status: "requested" },
  });
  const cabinet = await referrerCabinetForAccount(account);
  return NextResponse.json({ ok: true, cabinet });
}
