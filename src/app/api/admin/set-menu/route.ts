// Разовая служебная ручка: сменить URL кнопки мини-аппа (обход старого кэша Telegram).
// Токен бота берётся из окружения и наружу не отдаётся. Гейт — одноразовый ключ в query.
// После использования этот роут удаляется.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const KEY = "prime-menu-2f9c7a1e5b";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== KEY) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN не задан" }, { status: 500 });

  const base = "https://api.telegram.org/bot" + token;

  // текущее состояние кнопки
  const cur = await fetch(base + "/getChatMenuButton", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));

  if (url.searchParams.get("read") === "1") {
    return NextResponse.json({ ok: true, current: cur });
  }

  const webAppUrl = url.searchParams.get("u") || "https://referalka.vercel.app/tma.html?v=2";
  const text = url.searchParams.get("t") || cur?.result?.text || "Открыть кабинет";

  const set = await fetch(base + "/setChatMenuButton", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu_button: { type: "web_app", text, web_app: { url: webAppUrl } } }),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));

  return NextResponse.json({ ok: true, was: cur?.result || null, setUrl: webAppUrl, text, telegram: set });
}
