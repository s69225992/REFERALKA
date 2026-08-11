// Ручной запуск цикла из админки (для теста/досчёта). Защищён ADMIN_TOKEN.
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { runCycle, runWeeklyCycle } from "@/lib/services/cycle";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!config.adminToken || req.headers.get("authorization") !== `Bearer ${config.adminToken}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    config.assertFleet();
    const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
    const result = body.from && body.to ? await runCycle(body.from, body.to) : await runWeeklyCycle();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
