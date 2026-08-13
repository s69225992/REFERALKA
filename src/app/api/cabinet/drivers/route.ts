// Список водителей из нашей БД (для кабинета менеджера): id, yandex id, ФИО, реф-код
// и текущий реферер (водитель или агент), если привязан. Сессионная авторизация.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const drivers = await prisma.driver.findMany({
    select: {
      id: true,
      yandexDriverId: true,
      fullName: true,
      referralCode: true,
      asReferredLink: {
        select: {
          tariffCode: true,
          referrer: { select: { fullName: true, referralCode: true } },
          agent: { select: { fullName: true, referralCode: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const rows = drivers.map((d: (typeof drivers)[number]) => {
    const link = d.asReferredLink;
    let referrer: { type: "driver" | "agent"; name: string; code: string } | null = null;
    if (link) {
      if (link.referrer) {
        referrer = {
          type: "driver",
          name: link.referrer.fullName ?? link.referrer.referralCode,
          code: link.referrer.referralCode,
        };
      } else if (link.agent) {
        referrer = {
          type: "agent",
          name: link.agent.fullName ?? link.agent.referralCode,
          code: link.agent.referralCode,
        };
      }
    }
    return {
      id: d.id,
      yandexDriverId: d.yandexDriverId,
      fullName: d.fullName,
      referralCode: d.referralCode,
      tariffCode: link?.tariffCode ?? null,
      referrer,
    };
  });

  return NextResponse.json({ ok: true, drivers: rows });
}
