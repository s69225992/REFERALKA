// Клиент Yandex Fleet API (TypeScript).
// Инкапсулирует авторизацию и нужные рефералке методы.
// ВАЖНО: точные имена полей ответов сверяй с офиц. документацией Fleet API —
// парсинг сделан оборонительно. https://fleet.yandex.ru/docs/api/
import { config } from "@/lib/config";

type Json = Record<string, unknown>;

export class FleetClient {
  private clientId: string;
  private apiKey: string;
  private parkId: string;
  private baseUrl: string;

  constructor() {
    this.clientId = config.fleet.clientId;
    this.apiKey = config.fleet.apiKey;
    this.parkId = config.fleet.parkId;
    this.baseUrl = config.fleet.baseUrl.replace(/\/$/, "");
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "X-Client-ID": this.clientId,
      "X-Api-Key": this.apiKey,
      "X-Park-ID": this.parkId,
      "Accept-Language": "ru",
      "Content-Type": "application/json",
      ...(extra ?? {}),
    };
  }

  private async post(path: string, body: Json, extra?: Record<string, string>): Promise<Json> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(extra),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Fleet API ${path} -> ${res.status}: ${text}`);
    }
    return (await res.json()) as Json;
  }

  // POST с повторами на 429 (Limit exceeded) — у orders/list жёсткий лимит частоты.
  private async postWithRetry(path: string, body: Json, tries = 6, baseDelayMs = 600): Promise<Json> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.post(path, body);
      } catch (e) {
        const msg = String(e);
        if (msg.includes("-> 429") && attempt < tries - 1) {
          await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1))); // 0.6s, 1.2s, 1.8s...
          continue;
        }
        throw e;
      }
    }
  }

  private async get(path: string, params: Record<string, string>): Promise<Json> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.baseUrl}${path}?${qs}`, { headers: this.headers() });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Fleet API ${path} -> ${res.status}: ${text}`);
    }
    return (await res.json()) as Json;
  }

  // Все профили исполнителей парка (постранично).
  async listDrivers(limit = 1000): Promise<Json[]> {
    const drivers: Json[] = [];
    let offset = 0;
    for (;;) {
      const data = await this.post("/v1/parks/driver-profiles/list", {
        query: { park: { id: this.parkId } },
        limit,
        offset,
      });
      const batch = (data.driver_profiles as Json[]) ?? [];
      drivers.push(...batch);
      const total = (data.total as number) ?? drivers.length;
      offset += limit;
      if (offset >= total || batch.length === 0) break;
    }
    return drivers;
  }

  // Справочник категорий транзакций (нужен один раз, чтобы найти id комиссии парка).
  async listTransactionCategories(): Promise<Json[]> {
    const data = await this.post("/v2/parks/transactions/categories/list", {
      query: { park: { id: this.parkId } },
    });
    return (data.categories as Json[]) ?? [];
  }

  // Транзакции по одному водителю за период (ISO 8601), с перебором cursor.
  async listDriverTransactions(driverId: string, from: string, to: string, limit = 1000): Promise<Json[]> {
    const out: Json[] = [];
    let cursor: string | undefined;
    for (;;) {
      const body: Json = {
        query: {
          park: {
            id: this.parkId,
            driver_profile: { id: driverId },
            transaction: { event_at: { from, to } },
          },
        },
        limit,
      };
      if (cursor) body.cursor = cursor;
      // postWithRetry — повтор на 429, чтобы безопасно тянуть транзакции параллельно.
      const data = await this.postWithRetry("/v2/parks/driver-profiles/transactions/list", body);
      out.push(...(((data.transactions as Json[]) ?? [])));
      cursor = data.cursor as string | undefined;
      if (!cursor) break;
    }
    return out;
  }

  // Кол-во заказов парка за период (ISO 8601), фильтр по booked_at, перебор cursor.
  // Best-effort: считаем длину страниц. Guard ограничивает число страниц (защита от
  // бесконечного цикла / чрезмерной нагрузки). Имена полей — оборонительно.
  async countOrders(from: string, to: string, limit = 500): Promise<number> {
    let count = 0;
    let cursor: string | undefined;
    for (let guard = 0; guard < 1000; guard++) {
      const body: Json = {
        query: { park: { id: this.parkId, order: { booked_at: { from, to } } } },
        limit,
      };
      if (cursor) body.cursor = cursor;
      const data = await this.postWithRetry("/v1/parks/orders/list", body);
      const batch = (data.orders as Json[]) ?? [];
      count += batch.length;
      cursor = data.cursor as string | undefined;
      if (!cursor || batch.length === 0) break;
      await new Promise((r) => setTimeout(r, 250)); // пауза между страницами против 429
    }
    return count;
  }

  // Только УСПЕШНО ЗАВЕРШЁННЫЕ заказы за период, с группировкой по водителю.
  // ВАЖНО: считаем по ВРЕМЕНИ ЗАВЕРШЕНИЯ (ended_at), а не по booked_at — чтобы цифра
  // совпадала со сводкой Fleet «Успешно завершённые заказы» (она группирует по дате
  // завершения). Заказ мог быть создан до начала суток, а завершиться внутри —
  // поэтому тянем страницы с запасом назад по booked_at, а затем оставляем только те,
  // чей ended_at попал в целевое окно [from, to]. Комиссия уже считается по event_at
  // транзакций (тоже момент завершения), поэтому деньги и так совпадают — эта правка
  // выравнивает и счётчик заказов на границах суток.
  // Fallback: если у заказа нет ended_at, берём booked_at (тогда поведение как раньше).
  async ordersByDriver(
    from: string,
    to: string,
    limit = 500,
  ): Promise<{
    total: number;
    byDriver: Record<string, number>;
    statusCounts: Record<string, number>;
    sampleKeys: string[];
    withEndedAt: number;
    completeSeen: number;
  }> {
    const padHours = Number(process.env.ORDERS_END_PAD_HOURS ?? 48);
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const fetchFrom = new Date(fromMs - padHours * 60 * 60 * 1000).toISOString();

    let total = 0;
    const byDriver: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    let sampleKeys: string[] = [];
    let withEndedAt = 0; // сколько «завершённых» заказов реально имели ended_at (диагностика)
    let completeSeen = 0; // всего заказов со статусом complete в окне выборки (диагностика)
    let cursor: string | undefined;
    for (let guard = 0; guard < 1000; guard++) {
      const body: Json = {
        query: { park: { id: this.parkId, order: { booked_at: { from: fetchFrom, to } } } },
        limit,
      };
      if (cursor) body.cursor = cursor;
      const data = await this.postWithRetry("/v1/parks/orders/list", body);
      const batch = (data.orders as Json[]) ?? [];
      if (sampleKeys.length === 0 && batch[0]) sampleKeys = Object.keys(batch[0] as Json);
      for (const raw of batch) {
        const o = raw as Json;
        const status = String(o.status ?? "");
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        if (status !== "complete") continue; // только успешно завершённые
        completeSeen++;
        // Момент завершения: ended_at (основной), иначе booked_at (совместимый fallback).
        const endedRaw = (o.ended_at as string) || "";
        if (endedRaw) withEndedAt++;
        const endMs = endedRaw
          ? new Date(endedRaw).getTime()
          : new Date((o.booked_at as string) || "").getTime();
        // Учитываем только заказы, завершившиеся внутри целевого окна [from, to].
        if (!Number.isNaN(endMs) && (endMs < fromMs || endMs > toMs)) continue;
        total++;
        const dp = o.driver_profile as Json | undefined;
        const perf = o.performer as Json | undefined;
        const perfDp = perf?.driver_profile as Json | undefined;
        const did =
          (o.driver_profile_id as string) ||
          (dp?.id as string) ||
          (perf?.driver_profile_id as string) ||
          (perfDp?.id as string) ||
          "";
        if (did) byDriver[did] = (byDriver[did] ?? 0) + 1;
      }
      cursor = data.cursor as string | undefined;
      if (!cursor || batch.length === 0) break;
      await new Promise((r) => setTimeout(r, 250)); // пауза между страницами против 429
    }
    return { total, byDriver, statusCounts, sampleKeys, withEndedAt, completeSeen };
  }

  // Создать транзакцию на балансе водителя (ВЫПЛАТА). idempotencyKey -> X-Idempotency-Token.
  async createTransaction(args: {
    driverId: string;
    amount: string; // decimal-строка, не ноль
    categoryId: string;
    description: string;
    idempotencyKey: string;
  }): Promise<Json> {
    return this.post(
      "/v2/parks/driver-profiles/transactions",
      {
        amount: args.amount,
        category_id: args.categoryId,
        description: args.description,
        driver_profile_id: args.driverId,
        park_id: this.parkId,
      },
      { "X-Idempotency-Token": args.idempotencyKey },
    );
  }

  async getTransactionStatus(transactionId: string): Promise<Json> {
    return this.get("/v2/parks/driver-profiles/transactions/by-id", {
      park_id: this.parkId,
      transaction_id: transactionId,
    });
  }
}
