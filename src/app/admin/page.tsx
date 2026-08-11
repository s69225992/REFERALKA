// Админ-кабинет: сводка + последние начисления + водители.
// ВНИМАНИЕ: для MVP страница читает БД напрямую. Перед публикацией закрой её
// авторизацией (middleware/Auth) — см. README, раздел "Безопасность".
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function money(x: unknown): string {
  return Number(x ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function AdminPage() {
  const [drivers, activeReferrals, pendingAgg, paidAgg, accruals] = await Promise.all([
    prisma.driver.count(),
    prisma.referral.count({ where: { active: true } }),
    prisma.referralAccrual.aggregate({ where: { status: "pending" }, _sum: { amount: true } }),
    prisma.referralAccrual.aggregate({ where: { status: "paid" }, _sum: { amount: true } }),
    prisma.referralAccrual.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { referrer: true, referred: true },
    }),
  ]);

  return (
    <main className="container">
      <h1>Админ-кабинет</h1>
      <p className="sub">Реферальная программа — сводка по парку</p>

      <div className="grid">
        <div className="card">
          <div className="label">Водителей всего</div>
          <div className="value">{drivers}</div>
        </div>
        <div className="card">
          <div className="label">Активных рефералов</div>
          <div className="value">{activeReferrals}</div>
        </div>
        <div className="card">
          <div className="label">К выплате (pending)</div>
          <div className="value">{money(pendingAgg._sum.amount)} ₽</div>
        </div>
        <div className="card">
          <div className="label">Выплачено всего</div>
          <div className="value">{money(paidAgg._sum.amount)} ₽</div>
        </div>
      </div>

      <div className="section-title">Последние начисления</div>
      {accruals.length === 0 ? (
        <div className="card empty">Пока нет начислений. Запусти цикл расчёта.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Реферер</th>
              <th>Реферал</th>
              <th>Период</th>
              <th>Комиссия парка</th>
              <th>Начислено</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {accruals.map((a) => (
              <tr key={a.id}>
                <td>{a.referrer.fullName ?? a.referrer.yandexDriverId}</td>
                <td>{a.referred.fullName ?? a.referred.yandexDriverId}</td>
                <td>
                  {a.periodFrom.toISOString().slice(0, 10)} — {a.periodTo.toISOString().slice(0, 10)}
                </td>
                <td>{money(a.baseAmount)} ₽</td>
                <td>{money(a.amount)} ₽</td>
                <td>
                  <span className={`badge ${a.status}`}>{a.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
