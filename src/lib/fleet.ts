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
      const data = await this.post("/v2/parks/driver-profiles/transactions/list", body);
      out.push(...(((data.transactions as Json[]) ?? [])));
      cursor = data.cursor as string | undefined;
      if (!cursor) break;
    }
    return out;
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
