// Тестовый отчёт через API (без базы). Защита ADMIN_TOKEN — в заголовке
// "Authorization: Bearer <token>" ИЛИ в query "?token=<token>" (удобно для теста в браузере).
//
// Пример:
//   /api/admin/test-report?token=XXX&from=2026-08-01&to=2026-08-08
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";
import { buildTestReport } from "@/lib/services/report";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Секрет для проверки сессии кабинета — тот же, что при выдаче в /api/cabinet/login.
function sessionSecret(): string {
  return process.env.CABINET_TOKEN || config.adminToken || "";
}
// Проверка подписанного сессионного токена (payload.signature) и срока действия.
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

// Доступ: админ-токен (полный) ИЛИ read-only токен кабинета (CABINET_TOKEN)
// ИЛИ действующий сессионный токен, выданный после входа по логину/паролю.
// Эндпоинт только читает (строит отчёт, без записи).
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

// Fleet требует дату-время; если пришла только дата (YYYY-MM-DD) — дополняем.
function normDate(s: string): string {
  return /T/.test(s) ? s : `${s}T00:00:00.000Z`;
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
    const from = normDate(sp.get("from") ?? def.from);
    const to = normDate(sp.get("to") ?? def.to);
    const report = await buildTestReport(from, to);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
