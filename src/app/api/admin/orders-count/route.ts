// Кол-во заказов парка за период — отдельный лёгкий эндпоинт для кабинета.
// Вынесен из основного отчёта, чтобы подсчёт заказов не тормозил и не ломал
// дашборд: если Fleet вернёт ошибку, падает только эта карточка.
//
// Пример: /api/admin/orders-count?token=XXX&from=2026-08-01&to=2026-08-08
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";
import { FleetClient } from "@/lib/fleet";

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

// --- Даты: та же логика, что в test-report (голая дата -> начало/конец дня, непустой интервал) ---
function normFrom(s: string): string {
  return /T/.test(s) ? s : `${s}T00:00:00.000Z`;
}
function normTo(s: string): string {
  return /T/.test(s) ? s : `${s}T23:59:59.999Z`;
}
function ensureInterval(from: string, to: string): { from: string; to: string } {
  let f = new Date(from).getTime();
  let t = new Date(to).getTime();
  if (!Number.isFinite(f)) f = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(t) || t <= f) t = f + 24 * 60 * 60 * 1000;
  return { from: new Date(f).toISOString(), to: new Date(t).toISOString() };
}
function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 7);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const sp = req.nextUrl.searchParams;
    const def = defaultPeriod();
    const { from, to } = ensureInterval(
      normFrom(sp.get("from") ?? def.from),
      normTo(sp.get("to") ?? def.to),
    );
    const { total, byDriver, statusCounts, sampleKeys } = await new FleetClient().ordersByDriver(from, to);
    return NextResponse.json({ ok: true, orders: total, byDriver, statusCounts, sampleKeys, from, to });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
