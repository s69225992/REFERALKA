// Заявки водителей на привязку к профилю парка (по номеру). Менеджер видит список
// и подтверждает/отклоняет. GET — список pending. POST {id, action:'approve'|'reject'}.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const reqs = await prisma.driverLinkRequest.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  // подтянем имена водителей и телеграм аккаунтов
  const driverIds = [...new Set(reqs.map((r: { claimedDriverId: number }) => r.claimedDriverId))];
  const accountIds = [...new Set(reqs.map((r: { accountId: number }) => r.accountId))];
  const [drivers, accounts] = await Promise.all([
    prisma.driver.findMany({ where: { id: { in: driverIds } }, select: { id: true, fullName: true, phone: true } }),
    prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, telegramId: true } }),
  ]);
  const dMap = new Map<number, any>(drivers.map((d: any) => [d.id, d]));
  const aMap = new Map<number, any>(accounts.map((a: any) => [a.id, a]));

  const list = reqs.map((r: any) => ({
    id: r.id,
    driverName: dMap.get(r.claimedDriverId)?.fullName ?? null,
    driverPhone: dMap.get(r.claimedDriverId)?.phone ?? null,
    parkPhone: r.parkPhone,
    telegramId: aMap.get(r.accountId)?.telegramId ?? null,
    createdAt: r.createdAt,
  }));
  return NextResponse.json({ ok: true, requests: list });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, action } = (await req.json().catch(() => ({}))) as { id?: number; action?: string };
  if (!id || (action !== "approve" && action !== "reject"))
    return NextResponse.json({ error: "id and action (approve|reject) required" }, { status: 400 });

  const lr = await prisma.driverLinkRequest.findUnique({ where: { id: Number(id) } });
  if (!lr || lr.status !== "pending")
    return NextResponse.json({ error: "заявка не найдена или уже обработана" }, { status: 404 });

  if (action === "approve") {
    // привязываем аккаунт к водителю
    await prisma.account.update({
      where: { id: lr.accountId },
      data: { driverId: lr.claimedDriverId, role: "driver" },
    });
    await prisma.driverLinkRequest.update({
      where: { id: lr.id },
      data: { status: "approved", decidedAt: new Date() },
    });
    return NextResponse.json({ ok: true, approved: true });
  }

  await prisma.driverLinkRequest.update({
    where: { id: lr.id },
    data: { status: "rejected", decidedAt: new Date() },
  });
  return NextResponse.json({ ok: true, rejected: true });
}
