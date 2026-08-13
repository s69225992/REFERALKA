// Управление агентами (внешние рефереры). Защита ADMIN_TOKEN.
// GET  — список агентов.
// POST — создать агента (fullName / phone / email), генерит уникальный реф-код.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(len = 6): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
// Код уникален и среди водителей, и среди агентов (единое пространство кодов).
async function uniqueCode(): Promise<string> {
  for (;;) {
    const code = randomCode();
    const [d, a] = await Promise.all([
      prisma.driver.findUnique({ where: { referralCode: code } }),
      prisma.agent.findUnique({ where: { referralCode: code } }),
    ]);
    if (!d && !a) return code;
  }
}
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ ok: true, agents });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    fullName?: string;
    phone?: string;
    email?: string;
  };
  if (!body.fullName && !body.phone && !body.email) {
    return NextResponse.json({ error: "fullName or phone or email required" }, { status: 400 });
  }
  try {
    const agent = await prisma.agent.create({
      data: {
        fullName: body.fullName?.trim() || null,
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        referralCode: await uniqueCode(),
      },
    });
    return NextResponse.json({ ok: true, agent });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
