// Привязка Telegram-аккаунта по номеру. Агент по номеру — привязываем сразу.
// Водитель по номеру — создаём заявку менеджеру на подтверждение (accounts + driver_link_requests).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInitData } from "@/lib/telegram";
import { normalizePhone } from "@/lib/phone";
import { referrerCabinet } from "@/lib/services/referrerData";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { initData, phone } = (await req.json().catch(() => ({}))) as { initData?: string; phone?: string };
  const v = verifyInitData(initData || "");
  if (!v.ok || !v.user) return NextResponse.json({ ok: false, error: v.error || "auth" }, { status: 401 });

  const np = normalizePhone(phone);
  if (np.length < 10) return NextResponse.json({ ok: false, error: "Введите корректный номер" }, { status: 400 });
  const telegramId = String(v.user.id);

  // 1) агент по номеру -> привязываем сразу
  const agents = await prisma.agent.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } });
  const agent = agents.find((a: { id: number; phone: string | null }) => normalizePhone(a.phone) === np);
  if (agent) {
    await prisma.account.upsert({
      where: { telegramId },
      create: { telegramId, agentId: agent.id, role: "agent" },
      update: { agentId: agent.id, role: "agent" },
    });
    const cabinet = await referrerCabinet("agent", agent.id);
    return NextResponse.json({ ok: true, linked: true, cabinet });
  }

  // 2) водитель по номеру -> заявка менеджеру на подтверждение
  const drivers = await prisma.driver.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true, fullName: true },
  });
  const driver = drivers.find((d: { id: number; phone: string | null }) => normalizePhone(d.phone) === np);
  if (driver) {
    const account = await prisma.account.upsert({
      where: { telegramId },
      create: { telegramId, role: "driver" },
      update: {},
    });
    // уже привязан к этому водителю?
    if (account.driverId === driver.id) {
      const cabinet = await referrerCabinet("driver", driver.id);
      return NextResponse.json({ ok: true, linked: true, cabinet });
    }
    // нет ли уже открытой заявки
    const existing = await prisma.driverLinkRequest.findFirst({
      where: { accountId: account.id, claimedDriverId: driver.id, status: "pending" },
    });
    if (!existing) {
      await prisma.driverLinkRequest.create({
        data: {
          accountId: account.id,
          claimedDriverId: driver.id,
          parkPhone: phone!.trim(),
          telegramPhone: null,
          status: "pending",
        },
      });
    }
    return NextResponse.json({ ok: true, pending: true, driverName: driver.fullName });
  }

  return NextResponse.json({ ok: true, notFound: true });
}
