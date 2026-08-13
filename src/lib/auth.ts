// Общая авторизация для админ/кабинет-эндпоинтов.
// Принимает: ADMIN_TOKEN, CABINET_TOKEN или подписанный сессионный токен кабинета
// (тот же, что выдаёт /api/cabinet/login и принимают test-report/orders-count).
import { NextRequest } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";

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

export function authed(req: NextRequest): boolean {
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
