// Запуск синхронизации водителей Fleet -> локальная БД. Защита ADMIN_TOKEN.
// Вызвать после деплоя: /api/admin/sync-drivers?token=<ADMIN_TOKEN> (GET или POST).
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { syncDrivers } from "@/lib/services/sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  if (!config.adminToken) return false;
  if (req.headers.get("authorization") === `Bearer ${config.adminToken}`) return true;
  return req.nextUrl.searchParams.get("token") === config.adminToken;
}

async function run(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const result = await syncDrivers();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
