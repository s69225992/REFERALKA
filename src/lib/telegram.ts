// Проверка подписи Telegram Mini App initData.
// Алгоритм Telegram: secret = HMAC_SHA256(key="WebAppData", token);
// hash == HMAC_SHA256(key=secret, data_check_string). data_check_string — пары key=value
// (кроме hash), отсортированные по ключу и склеенные через \n.
import crypto from "crypto";

export type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

export function verifyInitData(initData: string): { ok: boolean; user?: TgUser; error?: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN не задан" };
  if (!initData) return { ok: false, error: "нет initData" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "нет hash" };
  params.delete("hash");

  const pairs = [...params.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheckString = pairs.join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (computed.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash))) {
    return { ok: false, error: "подпись неверна" };
  }

  // Свежесть (не старше 24 часов)
  const authDate = Number(params.get("auth_date") || 0);
  if (authDate && Date.now() / 1000 - authDate > 86400) return { ok: false, error: "initData устарел" };

  let user: TgUser | undefined;
  try {
    const u = params.get("user");
    if (u) user = JSON.parse(u) as TgUser;
  } catch {
    /* ignore */
  }
  if (!user?.id) return { ok: false, error: "нет пользователя" };
  return { ok: true, user };
}

export function tgDisplayName(u: TgUser): string {
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);
}
