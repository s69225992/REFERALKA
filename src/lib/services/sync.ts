// Синхронизация водителей парка из Fleet API в локальную базу.
import { prisma } from "@/lib/prisma";
import { FleetClient } from "@/lib/fleet";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len = 6): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

async function uniqueCode(): Promise<string> {
  for (;;) {
    const code = randomCode();
    const exists = await prisma.driver.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
}

function extract(profile: Record<string, unknown>) {
  const dp = (profile.driver_profile as Record<string, unknown>) ?? profile;
  const yandexId = dp.id as string | undefined;
  const fullName =
    [dp.last_name, dp.first_name, dp.middle_name].filter(Boolean).join(" ").trim() || null;
  const phones = (dp.phones as string[]) ?? [];
  const phone = phones[0] ?? null;
  return { yandexId, fullName, phone };
}

export async function syncDrivers(client = new FleetClient()) {
  let created = 0;
  let updated = 0;
  const profiles = await client.listDrivers();
  for (const profile of profiles) {
    const { yandexId, fullName, phone } = extract(profile);
    if (!yandexId) continue;
    const existing = await prisma.driver.findUnique({ where: { yandexDriverId: yandexId } });
    if (!existing) {
      await prisma.driver.create({
        data: { yandexDriverId: yandexId, fullName, phone, referralCode: await uniqueCode() },
      });
      created++;
    } else {
      await prisma.driver.update({
        where: { id: existing.id },
        data: { fullName: fullName ?? existing.fullName, phone: phone ?? existing.phone },
      });
      updated++;
    }
  }
  return { created, updated };
}
