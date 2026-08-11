#!/usr/bin/env node
// АВТОНОМНЫЙ тест-отчёт через Yandex Fleet API. Без npm install, без базы.
// Нужен только Node 18+ (встроенный fetch) и ключ Fleet API в переменных окружения.
//
// Запуск:
//   FLEET_API_KEY=... node report-standalone.mjs 2026-08-01 2026-08-08
//   (FLEET_CLIENT_ID/FLEET_PARK_ID уже вшиты дефолтами ниже — при желании переопредели)
//
// Что делает: берёт всех активных водителей, тянет их транзакции за период,
// суммирует комиссию парка и считает долю (по умолчанию 1/3). Выводит по водителям
// и ИТОГО. Строку "Комиссия парка (все активные)" сверь со своим доходом парка.

const CLIENT_ID = process.env.FLEET_CLIENT_ID || "422835";
const API_KEY = process.env.FLEET_API_KEY || "";
const PARK_ID = process.env.FLEET_PARK_ID || "3878feaa7de447c7954009f526955fef";
const BASE_URL = (process.env.FLEET_BASE_URL || "https://fleet-api.taxi.yandex.net").replace(/\/$/, "");
const RATE = Number(process.env.REFERRAL_RATE || "0.3333333333");
const COMMISSION_CATS = (process.env.PARK_COMMISSION_CATEGORY_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (!API_KEY) {
  console.error("❌ Не задан FLEET_API_KEY. Запусти так:\n   FLEET_API_KEY=<секрет> node report-standalone.mjs 2026-08-01 2026-08-08");
  process.exit(1);
}

const headers = {
  "X-Client-ID": CLIENT_ID,
  "X-Api-Key": API_KEY,
  "X-Park-ID": PARK_ID,
  "Accept-Language": "ru",
  "Content-Type": "application/json",
};

async function post(path, body, extra = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

async function listDrivers() {
  const out = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const data = await post("/v1/parks/driver-profiles/list", {
      query: { park: { id: PARK_ID } }, limit, offset,
    });
    const batch = data.driver_profiles || [];
    out.push(...batch);
    const total = data.total ?? out.length;
    offset += limit;
    if (offset >= total || batch.length === 0) break;
  }
  return out;
}

async function listCategories() {
  try {
    const data = await post("/v2/parks/transactions/categories/list", { query: { park: { id: PARK_ID } } });
    return data.categories || [];
  } catch {
    return [];
  }
}

async function listDriverTransactions(driverId, from, to) {
  const out = [];
  let cursor;
  for (;;) {
    const body = {
      query: { park: { id: PARK_ID, driver_profile: { id: driverId }, transaction: { event_at: { from, to } } } },
      limit: 1000,
    };
    if (cursor) body.cursor = cursor;
    const data = await post("/v2/parks/driver-profiles/transactions/list", body);
    out.push(...(data.transactions || []));
    cursor = data.cursor;
    if (!cursor) break;
  }
  return out;
}

function rub(n) {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function driverInfo(p) {
  const dp = p.driver_profile || p;
  const name = [dp.last_name, dp.first_name, dp.middle_name].filter(Boolean).join(" ").trim() || dp.id;
  return { id: dp.id, name, workStatus: dp.work_status || "" };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  let from, to;
  if (args.length === 2) {
    [from, to] = args;
  } else {
    const t = new Date(); t.setUTCHours(0, 0, 0, 0);
    const f = new Date(t); f.setUTCDate(f.getUTCDate() - 7);
    from = f.toISOString(); to = t.toISOString();
  }

  const legend = {};
  for (const c of await listCategories()) if (c.id) legend[c.id] = c.name || c.id;

  const profiles = await listDrivers();
  const active = profiles.filter((p) => (driverInfo(p).workStatus || "") !== "fired");

  console.log(`\nПериод: ${from} — ${to}`);
  console.log(`Активных водителей: ${active.length}`);
  console.log(`Доля реферера: ${(RATE * 100).toFixed(2)}%`);
  if (COMMISSION_CATS.length === 0) {
    console.log("\n⚠ PARK_COMMISSION_CATEGORY_IDS не задан — покажу разбивку по всем категориям списаний,");
    console.log("  чтобы ты (или я) определил, какая из них = комиссия парка.\n");
  }

  let totalCommission = 0, totalShare = 0;
  const rows = [];
  for (const p of active) {
    const { id, name } = driverInfo(p);
    if (!id) continue;
    const txs = await listDriverTransactions(id, from, to);
    const byCat = {};
    let commission = 0;
    for (const tx of txs) {
      const cat = tx.category_id || tx.category_name || "unknown";
      const amt = Number(tx.amount ?? 0);
      if (amt < 0) {
        byCat[cat] = (byCat[cat] || 0) + -amt;
        if (COMMISSION_CATS.includes(cat)) commission += -amt;
      }
    }
    commission = Math.round(commission * 100) / 100;
    const share = Math.round(commission * RATE * 100) / 100;
    rows.push({ name, commission, share, byCat });
    totalCommission += commission;
    totalShare += share;
  }
  rows.sort((a, b) => b.commission - a.commission);

  for (const r of rows) {
    console.log(`  ${String(r.name).padEnd(28)} комиссия парка: ${rub(r.commission).padStart(12)} ₽   доля: ${rub(r.share).padStart(10)} ₽`);
    if (COMMISSION_CATS.length === 0) {
      for (const [cat, sum] of Object.entries(r.byCat)) {
        console.log(`        • ${legend[cat] || cat} (${cat}): ${rub(sum)} ₽`);
      }
    }
  }

  console.log("\n=== ИТОГО ===");
  console.log(`Комиссия парка (все активные): ${rub(Math.round(totalCommission * 100) / 100)} ₽   <- сверь с доходом парка`);
  console.log(`Доля рефереров (${(RATE * 100).toFixed(2)}%):        ${rub(Math.round(totalShare * 100) / 100)} ₽`);
}

main().catch((e) => { console.error("Ошибка:", e.message); process.exit(1); });
