// Тестовый отчёт через API (без базы). Защита ADMIN_TOKEN — в заголовке
// "Authorization: Bearer <token>" ИЛИ в query "?token=<token>" (удобно для теста в браузере).
//
// Пример:
//   /api/admin/test-report?token=XXX&from=2026-08-01&to=2026-08-08
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";
import { hybridPeriod, mskDateFromAny, mskDateStr } from "@/lib/services/dailyStats";

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

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    config.assertFleet();
    const sp = req.nextUrl.searchParams;
    const fromDate = sp.get("from") ? mskDateFromAny(sp.get("from") as string) : mskDateStr(7);
    const toDate = sp.get("to") ? mskDateFromAny(sp.get("to") as string) : mskDateStr(0);

    // Старые дни — из склада, последние — живьём (см. hybridPeriod).
    const { acc, split } = await hybridPeriod(fromDate, toDate, { commission: true });
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const rows = [...acc.entries()]
      .map(([yid, e]) => ({
        driverId: yid,
        name: e.name,
        workStatus: "",
        parkCommission: round2(e.parkCommission),
        referralShare: 0,
        byCategory: {} as Record<string, number>,
      }))
      .sort((a, b) => b.parkCommission - a.parkCommission);
    const totalCommission = round2(rows.reduce((s, r) => s + r.parkCommission, 0));

    const report = {
      period: { from: fromDate, to: toDate },
      rate: config.referral.rate,
      commissionCategoryIds: config.referral.commissionCategoryIds,
      categoriesLegend: {} as Record<string, string>,
      activeDrivers: rows.filter((r) => r.parkCommission > 0).length,
      totals: { parkCommission: totalCommission, referralShare: 0 },
      rows,
      source: split,
    };
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
