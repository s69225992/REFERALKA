// Одноразовая инициализация: засев базовых тарифов. Защита ADMIN_TOKEN.
// Вызвать один раз после деплоя: /api/admin/init?token=<ADMIN_TOKEN>
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const TARIFFS = [
  { code: "3_1", name: "3 / 1", parkRate: "3.000", refRate: "1.000", sort: 1 },
  { code: "4_1.5", name: "4 / 1,5", parkRate: "4.000", refRate: "1.500", sort: 2 },
  { code: "5_2", name: "5 / 2", parkRate: "5.000", refRate: "2.000", sort: 3 },
];

function authed(req: NextRequest): boolean {
  if (!config.adminToken) return false;
  if (req.headers.get("authorization") === `Bearer ${config.adminToken}`) return true;
  return req.nextUrl.searchParams.get("token") === config.adminToken;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    for (const t of TARIFFS) {
      await prisma.tariff.upsert({ where: { code: t.code }, create: t, update: t });
    }
    const count = await prisma.tariff.count();
    return NextResponse.json({ ok: true, tariffs: count });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
