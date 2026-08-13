// Кол-во заказов парка за период — отдельный лёгкий эндпоинт для кабинета.
// Вынесен из основного отчёта, чтобы подсчёт заказов не тормозил и не ломал
// дашборд: если Fleet вернёт ошибку, падает только эта карточка.
//
// Пример: /api/admin/orders-count?token=XXX&from=2026-08-01&to=2026-08-08
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";
import { hybridPeriod, mskDateFromAny, mskDateStr } from "@/lib/services/dailyStats";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// --- Доступ: те же токены, что и у /api/admin/test-report ---
function sessionSecret(): string {
  return process.env.CABINET_TOKEN || config.adminToken || "";
}
function verifySession(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const secret = sessionSecret();
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    const data = JSON.parse(json);
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}
function authed(req: NextRequest): boolean {
  const header = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("token");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const tokens = [config.adminToken, process.env.CABINET_TOKEN || ""].filter(Boolean);
  for (const t of tokens) {
    if (header === `Bearer ${t}`) return true;
    if (q === t) return true;
  }
  if (bearer && verifySession(bearer)) return true;
  if (q && verifySession(q)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const sp = req.nextUrl.searchParams;
    const fromDate = sp.get("from") ? mskDateFromAny(sp.get("from") as string) : mskDateStr(7);
    const toDate = sp.get("to") ? mskDateFromAny(sp.get("to") as string) : mskDateStr(0);

    // Старые дни — из склада, последние — живьём (см. hybridPeriod).
    const { acc, split } = await hybridPeriod(fromDate, toDate, { orders: true });
    const byDriver: Record<string, number> = {};
    let total = 0;
    for (const [yid, e] of acc) {
      byDriver[yid] = e.orders;
      total += e.orders;
    }
    return NextResponse.json({ ok: true, orders: total, byDriver, source: split });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
