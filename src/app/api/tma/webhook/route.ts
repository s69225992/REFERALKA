// Вебхук Telegram-бота. Когда пользователь делится своим номером (кнопка «Поделиться
// номером» в мини-аппе или в чате), Telegram шлёт сюда message.contact — сохраняем номер
// в accounts.pending_phone, чтобы мини-апп его подхватил. Защита — секретный заголовок.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await req.json().catch(() => ({}))) as any;
  try {
    const msg = update.message || update.edited_message;
    const contact = msg?.contact;
    const fromId = msg?.from?.id;
    // делимся ТОЛЬКО своим контактом (contact.user_id === отправитель)
    if (contact?.phone_number && fromId && (!contact.user_id || contact.user_id === fromId)) {
      const telegramId = String(fromId);
      await prisma.account.upsert({
        where: { telegramId },
        create: { telegramId, pendingPhone: String(contact.phone_number), role: "agent" },
        update: { pendingPhone: String(contact.phone_number) },
      });
    }
  } catch {
    /* никогда не отвечаем ошибкой Telegram, чтобы он не ретраил бесконечно */
  }
  return NextResponse.json({ ok: true });
}
