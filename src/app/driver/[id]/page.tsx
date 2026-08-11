// Личный кабинет водителя: код-приглашение, приведённые, начисления.
// В MVP доступ по id из URL. В проде — вход по телефону+SMS и выдача токена.
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function money(x: unknown): string {
  return Number(x ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function DriverPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const driver = await prisma.driver.findUnique({ where: { id } });
  if (!driver) return <main className="container"><h1>Водитель не найден</h1></main>;

  const [referrals, accruals] = await Promise.all([
    prisma.referral.findMany({ where: { referrerId: id, active: true }, include: { referred: true } }),
    prisma.referralAccrual.findMany({ where: { referrerId: id }, orderBy: { periodTo: "desc" } }),
  ]);

  const totalPaid = accruals.filter((a) => a.status === "paid").reduce((s, a) => s + Number(a.amount), 0);
  const totalPending = accruals.filter((a) => a.status === "pending").reduce((s, a) => s + Number(a.amount), 0);

  return (
    <main className="container">
      <h1>{driver.fullName ?? "Мой кабинет"}</h1>
      <p className="sub">Реферальная программа</p>

      <div className="grid">
        <div className="card">
          <div className="label">Мой код-приглашение</div>
          <div className="value"><span className="code">{driver.referralCode}</span></div>
        </div>
        <div className="card">
          <div className="label">Приведено водителей</div>
          <div className="value">{referrals.length}</div>
        </div>
        <div className="card">
          <div className="label">Выплачено</div>
          <div className="value">{money(totalPaid)} ₽</div>
        </div>
        <div className="card">
          <div className="label">Ожидает выплаты</div>
          <div className="value">{money(totalPending)} ₽</div>
        </div>
      </div>

      <div className="section-title">Мои рефералы</div>
      {referrals.length === 0 ? (
        <div className="card empty">Ты ещё никого не привёл. Поделись своим кодом!</div>
      ) : (
        <table>
          <thead>
            <tr><th>Водитель</th><th>Статус</th></tr>
          </thead>
          <tbody>
            {referrals.map((r) => (
              <tr key={r.id}>
                <td>{r.referred.fullName ?? r.referred.yandexDriverId}</td>
                <td>{r.referred.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-title">История начислений</div>
      {accruals.length === 0 ? (
        <div className="card empty">Начислений пока нет.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Период</th><th>Начислено</th><th>Статус</th></tr>
          </thead>
          <tbody>
            {accruals.map((a) => (
              <tr key={a.id}>
                <td>{a.periodFrom.toISOString().slice(0, 10)} — {a.periodTo.toISOString().slice(0, 10)}</td>
                <td>{money(a.amount)} ₽</td>
                <td><span className={`badge ${a.status}`}>{a.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
