"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { DAILY_DEPOSIT_LIMIT, type DepositState, type PublicStats } from "../lib/deposits";
import { ApiError, OFFLINE, request } from "./api-client";
import { cash } from "./roulette";

type DepositRequest = { amount: number; requestId: string };

export function WalletDeposit({ onDeposit }: { onDeposit(): void }) {
  const [open, setOpen] = useState(false);
  const [deposit, setDeposit] = useState<DepositState | null>(null);
  const [amount, setAmount] = useState("100");
  const [pending, setPending] = useState<DepositRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(false);
  const requested = Number(amount);
  const limit = deposit?.remaining ?? 0;
  const valid = Number.isSafeInteger(requested) && requested > 0 && requested <= limit;

  async function refresh() {
    setBusy(true);
    try {
      const latest = await request<DepositState>("/api/deposit");
      setDeposit(latest);
      setAmount(String(latest.remaining));
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || active.current || (!pending && !valid)) return;
    active.current = true;
    const next = pending ?? { amount: requested, requestId: crypto.randomUUID() };
    setPending(next);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await request<DepositState>("/api/deposit", next);
      setDeposit(updated);
      setAmount(String(updated.remaining));
      setPending(null);
      setNotice("Зараховано " + cash(next.amount) + ".");
      onDeposit();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) {
        setPending(null);
        if (failure.status === 422) await refresh();
      }
      setError(failure instanceof ApiError ? failure.message : "Повторіть запит, щоб перевірити поповнення.");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="wallet-deposit">
      <div className="bonus">
        <div>
          <strong>Віртуальний депозит</strong>
          <p>До {cash(DAILY_DEPOSIT_LIMIT)} на день. Новим гравцям — стартові 100 $.</p>
        </div>
        <button type="button" className="secondary" aria-expanded={open} disabled={busy}
          onClick={() => { setOpen(!open); if (!open && !pending) void refresh(); }}>
          {open ? "Згорнути" : "Поповнити"}
        </button>
      </div>
      {open && (
        <div className="deposit-form">
          {deposit && <p className="notice">Сьогодні доступно {cash(limit)}. Ліміт оновлюється опівночі за Києвом.</p>}
          <form onSubmit={submit}>
            <div>
              <label htmlFor="deposit-amount">Віртуальна сума</label>
              <div className="input-wrap">
                <input id="deposit-amount" inputMode="numeric" value={amount} autoComplete="off"
                  disabled={!deposit || limit === 0 || busy || !!pending}
                  onChange={(event) => { if (/^\d{0,3}$/.test(event.target.value)) setAmount(event.target.value); }} />
                <span aria-hidden="true">$</span>
              </div>
            </div>
            <button className="primary" disabled={busy || (!pending && !valid)}>
              {busy ? "Зачекай…" : pending ? "Повторити запит" : "Зарахувати"}
            </button>
          </form>
          {notice && <p className="notice result" role="status">{notice}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}

export function HelpStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/stats", { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("Stats unavailable");
      return response.json();
    }).then(setStats).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return (
    <section aria-label="Статистика Betbook">
      <dl className="stats">
        <div><dt>Чистий заробіток казино</dt><dd>{stats ? cash(stats.houseNet) : "—"}</dd></div>
        <div><dt>Людей зіграли</dt><dd>{stats ? stats.played.toLocaleString("uk-UA") : "—"}</dd></div>
      </dl>
      <p>{failed ? "Статистика тимчасово недоступна." : "Після останнього скидання. Заробіток від гри з ботами у віртуальних доларах."}</p>
    </section>
  );
}
