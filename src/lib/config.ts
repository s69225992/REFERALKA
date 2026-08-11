// Централизованный доступ к конфигу. Секреты — только из переменных окружения.
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  fleet: {
    // client_id и park_id известны и не секретны — вшиты дефолтами, чтобы на Vercel
    // нужно было задать только секрет (FLEET_API_KEY).
    clientId: process.env.FLEET_CLIENT_ID ?? "422835",
    apiKey: process.env.FLEET_API_KEY ?? "",
    parkId: process.env.FLEET_PARK_ID ?? "3878feaa7de447c7954009f526955fef",
    baseUrl: process.env.FLEET_BASE_URL ?? "https://fleet-api.taxi.yandex.net",
  },
  referral: {
    rate: Number(process.env.REFERRAL_RATE ?? "0.3333333333"),
    minPayout: Number(process.env.MIN_PAYOUT_AMOUNT ?? "1.00"),
    commissionCategoryIds: (process.env.PARK_COMMISSION_CATEGORY_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    payoutCategoryId: process.env.PAYOUT_CATEGORY_ID ?? "partner_service_manual",
  },
  cronSecret: process.env.CRON_SECRET ?? "",
  adminToken: process.env.ADMIN_TOKEN ?? "",
  // выбрасывает ошибку, если ключевые переменные не заданы (вызывать в рантайме, не при импорте)
  assertFleet() {
    req("FLEET_CLIENT_ID");
    req("FLEET_API_KEY");
    req("FLEET_PARK_ID");
  },
};
