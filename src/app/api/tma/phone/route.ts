// Привязка Telegram-аккаунта по номеру с учётом роли.
// role='agent'  — ищем агента по номеру, привязываем сразу.
// role='driver' — ищем водителя по номеру, создаём заявку менеджеру на подтверждение.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInitData, tgDisplayName } from "@/lib/telegram";
import { normalizePhone } from "@/lib/phone";
import { referrerCabinetForAccount } from "@/lib/services/referrerData";

export const dynamic = "force-dynamic";

// Генерация уникального реф-кода (единое пространство кодов с водителями).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(len = 6): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = randomCode();
    const [d, a] = await Promise.all([
      prisma.driver.findUnique({ where: { referralCode: code } }),
      prisma.agent.findUnique({ where: { referralCode: code } }),
    ]);
    if (!d && !a) return code;
  }
  return randomCode(8);
}

export async function POST(req: NextRequest) {
  const { initData, phone, role } = (await req.json().catch(() => ({}))) as {
    initData?: string;
    phone?: string;
    role?: string;
  };
  const v = verifyInitData(initData || "");
  if (!v.ok || !v.user) return NextResponse.json({ ok: false, error: v.error || "auth" }, { status: 401 });

  const np = normalizePhone(phone);
  if (np.length < 10) return NextResponse.json({ ok: false, error: "Введите корректный номер" }, { status: 400 });
  const telegramId = String(v.user.id);

  // ===== АГЕНТ =====
  // Бот — это и есть система саморегистрации агентов. Если агента с таким номером
  // ещё нет — заводим его сами (с реф-кодом) и сразу открываем кабинет. Менеджер не нужен.
  if (role === "agent") {
    const agents = await prisma.agent.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } });
    const found = agents.find((a: { id: number; phone: string | null }) => normalizePhone(a.phone) === np);
    let agentId: number;
    if (found) {
      agentId = found.id;
    } else {
      const created = await prisma.agent.create({
        data: {
          fullName: tgDisplayName(v.user) || null,
          phone: (phone || "").trim(),
          referralCode: await uniqueCode(),
          status: "active",
        },
      });
      agentId = created.id;
    }
    const account = await prisma.account.upsert({
      where: { telegramId },
      create: { telegramId, agentId, role: "agent" },
      update: { agentId, role: "agent" },
    });
    const cabinet = await referrerCabinetForAccount(account);
    return NextResponse.json({ ok: true, linked: true, cabinet });
  }

  // ===== ВОДИТЕЛЬ =====
  const drivers = await prisma.driver.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true, fullName: true },
  });
  const driver = drivers.find((d: { id: number; phone: string | null }) => normalizePhone(d.phone) === np);
  if (!driver) return NextResponse.json({ ok: true, notFound: true, role: "driver" });

  const account = await prisma.account.upsert({
    where: { telegramId },
    create: { telegramId, role: "driver" },
    update: {},
  });
  if (account.driverId === driver.id) {
    const cabinet = await referrerCabinetForAccount(account);
    return NextResponse.json({ ok: true, linked: true, cabinet });
  }
  const existing = await prisma.driverLinkRequest.findFirst({
    where: { accountId: account.id, claimedDriverId: driver.id, status: "pending" },
  });
  if (!existing) {
    await prisma.driverLinkRequest.create({
      data: {
        accountId: account.id,
        claimedDriverId: driver.id,
        parkPhone: phone!.trim(),
        telegramPhone: account.pendingPhone || null,
        status: "pending",
      },
    });
  }
  return NextResponse.json({ ok: true, pending: true, driverName: driver.fullName });
}
