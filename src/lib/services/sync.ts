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
  // Фото из Fleet (best-effort: не все парки/версии API его отдают).
  const photoRaw = dp.photo as unknown;
  const photoUrl =
    typeof photoRaw === "string"
      ? photoRaw
      : (((photoRaw as Record<string, unknown> | undefined)?.url as string | undefined) ?? null);
  return { yandexId, fullName, phone, photoUrl };
}

export async function syncDrivers(client = new FleetClient()) {
  let created = 0;
  let updated = 0;
  const profiles = await client.listDrivers();
  // Образец ключей ответа — чтобы понять, есть ли в профиле фото и как называется поле.
  const sampleKeys = profiles[0] ? Object.keys(profiles[0] as Record<string, unknown>) : [];
  const sampleDpKeys =
    profiles[0] && (profiles[0] as Record<string, unknown>).driver_profile
      ? Object.keys((profiles[0] as Record<string, unknown>).driver_profile as Record<string, unknown>)
      : [];
  for (const profile of profiles) {
    const { yandexId, fullName, phone, photoUrl } = extract(profile);
    if (!yandexId) continue;
    const existing = await prisma.driver.findUnique({ where: { yandexDriverId: yandexId } });
    if (!existing) {
      await prisma.driver.create({
        data: { yandexDriverId: yandexId, fullName, phone, photoUrl, referralCode: await uniqueCode() },
      });
      created++;
    } else {
      await prisma.driver.update({
        where: { id: existing.id },
        data: {
          fullName: fullName ?? existing.fullName,
          phone: phone ?? existing.phone,
          photoUrl: photoUrl ?? existing.photoUrl,
        },
      });
      updated++;
    }
  }
  return { created, updated, total: profiles.length, sampleKeys, sampleDpKeys };
}
