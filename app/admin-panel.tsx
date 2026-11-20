"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_ADMIN_CREDIT, type AdminStats } from "../lib/admin";
import { ApiError, OFFLINE, request } from "./api-client";
import { cash } from "./roulette";

type Credit = { amount: number; requestId: string };

export function AdminPanel({ onBalanceUpdated }: { onBalanceUpdated(): void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [amount, setAmount] = useState("1000");
  const [pending, setPending] = useState<Credit | null>(null);
  const [loading, setLoading] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  const value = Number(amount);
  const valid = Number.isSafeInteger(value) && value > 0 && value <= MAX_ADMIN_CREDIT;

  async function refresh() {
    if (active.current) return;
    active.current = true;
    setLoading(true);
    try {
      setStats(await request<AdminStats>("/api/admin"));
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : OFFLINE);
    } finally {
      active.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function grant(event: FormEvent) {
    event.preventDefault();
    if (active.current || (!pending && !valid)) return;
    active.current = true;
    const credit = pending ?? { amount: value, requestId: crypto.randomUUID() };
    setPending(credit);
    setCrediting(true);
    setError("");
    setFeedback("");
    try {
      const { balance } = await request<{ balance: number }>("/api/admin", credit);
      setStats((previous) => previous && { ...previous, balance });
      setFeedback("На ваш баланс зараховано " + cash(credit.amount) + ".");
      setPending(null);
      onBalanceUpdated();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) setPending(null);
      setError(failure instanceof ApiError ? failure.message : "Повторіть запит, щоб перевірити поповнення.");
    } finally {
      active.current = false;
      setCrediting(false);
    }
  }

  return (
    <section className="info-page admin-page">
      <div className="admin-heading">
        <h1>Адмінка</h1>
        <button type="button" className="secondary" disabled={loading || crediting} onClick={() => void refresh()}>Оновити</button>
      </div>
      <dl className="stats">
        <div><dt>Гравців зіграли</dt><dd>{stats?.played ?? "—"}</dd></div>
        <div><dt>Гравців у мінусі</dt><dd>{stats?.losing ?? "—"}</dd></div>
        <div><dt>Загальний чистий програш</dt><dd>{stats ? cash(stats.netLoss) : "—"}</dd></div>
      </dl>
      {stats?.pending && <p className="notice" role="status">Підраховуємо ставки із завершених раундів. Статистика оновиться автоматично.</p>}
      <div className="admin-credit">
        <h2>Мій баланс <span>{stats ? cash(stats.balance) : "—"}</span></h2>
        <form onSubmit={grant}>
          <div>
            <label htmlFor="admin-amount">Сума поповнення</label>
            <div className="input-wrap">
              <input id="admin-amount" type="text" inputMode="numeric" autoComplete="off" value={amount}
                disabled={crediting || !!pending}
                onChange={(event) => { if (/^\d{0,7}$/.test(event.target.value)) setAmount(event.target.value); }} />
              <span aria-hidden="true">$</span>
            </div>
          </div>
          <button className="primary" disabled={loading || crediting || !stats || (!pending && !valid)}>
            {crediting ? "Зараховуємо…" : pending ? "Повторити запит" : "Поповнити"}
          </button>
        </form>
        {feedback && <p className="notice result" role="status">{feedback}</p>}
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {stats && (
        <div className="entries">
          <h2>Найбільші чисті програші</h2>
          {stats.losses.length > 0 ? (
            <div className="entry-table">
              <table>
                <thead><tr><th scope="col">Гравець</th><th scope="col">Раунди</th><th scope="col">Програш</th></tr></thead>
                <tbody>{stats.losses.map((row) => (
                  <tr key={row.id}><th scope="row">{row.name}</th><td>{row.rounds}</td><td>{cash(row.netLoss)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p>Поки немає гравців із чистим програшем.</p>}
        </div>
      )}
    </section>
  );
}
