// Кабинет реферера (для «просмотра как» менеджером): профиль + приведённые + начисления.
// GET  ?type=agent|driver&id=N  — данные кабинета реферера.
// POST { type:'agent', id, fullName, phone, email, status } — правка профиля агента.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  const id = Number(sp.get("id"));
  if (!id || (type !== "agent" && type !== "driver"))
    return NextResponse.json({ error: "type (agent|driver) and id required" }, { status: 400 });

  const where = type === "agent" ? { agentId: id } : { referrerId: id };

  const [referrals, accruals] = await Promise.all([
    prisma.referral.findMany({
      where,
      include: {
        referred: { select: { id: true, fullName: true, referralCode: true, yandexDriverId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.referralAccrual.findMany({ where, orderBy: { periodTo: "desc" }, take: 100 }),
  ]);

  let profile:
    | { type: "agent" | "driver"; id: number; name: string | null; code: string; phone: string | null; email: string | null; photoUrl: string | null; status: string }
    | null = null;
  if (type === "agent") {
    const a = await prisma.agent.findUnique({ where: { id } });
    if (!a) return NextResponse.json({ error: "agent not found" }, { status: 404 });
    profile = { type: "agent", id: a.id, name: a.fullName, code: a.referralCode, phone: a.phone, email: a.email, photoUrl: a.photoUrl, status: a.status };
  } else {
    const d = await prisma.driver.findUnique({ where: { id } });
    if (!d) return NextResponse.json({ error: "driver not found" }, { status: 404 });
    profile = { type: "driver", id: d.id, name: d.fullName, code: d.referralCode, phone: d.phone, email: null, photoUrl: d.photoUrl, status: d.status };
  }

  const accrued = accruals.reduce((s: number, a: any) => s + Number(a.amount), 0);
  return NextResponse.json({
    ok: true,
    referrer: profile,
    referred: referrals.map((r: any) => ({
      driverId: r.referred.id,
      name: r.referred.fullName,
      code: r.referred.referralCode,
      tariffCode: r.tariffCode,
      qualifyingOrders: r.qualifyingOrders,
      activatedAt: r.activatedAt,
    })),
    accruals: accruals.map((a: any) => ({
      periodFrom: a.periodFrom,
      periodTo: a.periodTo,
      amount: a.amount.toString(),
      status: a.status,
    })),
    totals: {
      referredTotal: referrals.length,
      referredActive: referrals.filter((r: any) => r.activatedAt).length,
      accrued,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    id?: number;
    fullName?: string;
    phone?: string;
    email?: string;
    status?: string;
  };
  if (body.type !== "agent" || !body.id)
    return NextResponse.json({ error: "only agent profile is editable; type=agent and id required" }, { status: 400 });
  try {
    const agent = await prisma.agent.update({
      where: { id: Number(body.id) },
      data: {
        fullName: body.fullName?.trim() || null,
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        ...(body.status ? { status: body.status } : {}),
      },
    });
    return NextResponse.json({ ok: true, agent });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
