// Вход менеджера в кабинет: проверка логина/пароля на сервере и выдача
// подписанного сессионного токена (HMAC) на ограниченный срок.
// Логин и пароль хранятся в переменных окружения CABINET_LOGIN / CABINET_PASSWORD
// и НИКОГДА не попадают в статическую страницу кабинета.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

// Секрет для подписи сессии. Используем уже существующий CABINET_TOKEN
// (или ADMIN_TOKEN как запасной). Ротация секрета аннулирует все сессии.
function secret(): string {
  return process.env.CABINET_TOKEN || process.env.ADMIN_TOKEN || "";
}
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
}
function makeToken(): string {
  const payload = b64url(Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })));
  return `${payload}.${sign(payload)}`;
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const login = String(body?.login ?? "").trim();
  const password = String(body?.password ?? "");

  const expLogin = process.env.CABINET_LOGIN || "";
  const expPass = process.env.CABINET_PASSWORD || "";
  if (!expLogin || !expPass || !secret()) {
    return NextResponse.json({ ok: false, error: "Вход не настроен на сервере" }, { status: 500 });
  }

  const ok = safeEqual(login, expLogin) && safeEqual(password, expPass);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600)); // притормозить перебор
    return NextResponse.json({ ok: false, error: "Неверный логин или пароль" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, token: makeToken() });
}
