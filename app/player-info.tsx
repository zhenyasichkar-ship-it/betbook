"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_DEPOSIT, type DepositClaim, type DepositState, type PublicStats } from "../lib/deposits";
import { ApiError, OFFLINE, request } from "./api-client";
import { cash } from "./roulette";

export function WalletDeposit({ ready, onDeposit }: { ready: boolean; onDeposit(): void }) {
  const [deposit, setDeposit] = useState<DepositState | null>(null);
  const [clock, setClock] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(false);
  const offset = useRef(0);
  const remaining = deposit ? Math.max(0, Math.ceil((deposit.availableAt - clock) / 1000)) : 0;
  const coolingDown = remaining > 0;
  const countdown = Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0");

  function apply(next: DepositState) {
    offset.current = next.now - Date.now();
    setClock(next.now);
    setDeposit(next);
  }

  async function refresh() {
    try {
      apply(await request<DepositState>("/api/deposit"));
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : OFFLINE);
    }
  }

  useEffect(() => { if (ready) void refresh(); }, [ready]);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => setClock(Date.now() + offset.current), 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  async function claim() {
    if (active.current || !deposit || (!pending && coolingDown)) return;
    active.current = true;
    const requestId = pending ?? crypto.randomUUID();
    setPending(requestId);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await request<DepositClaim>("/api/deposit", { requestId });
      apply(updated);
      setPending(null);
      setNotice("Випало " + cash(updated.awarded) + ".");
      onDeposit();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) {
        setPending(null);
        if (failure.status === 429) await refresh();
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
          <p>Випадкова сума від 0 до {cash(MAX_DEPOSIT)} раз на годину.</p>
          {coolingDown && <p>Наступна спроба через <strong>{countdown}</strong></p>}
        </div>
        <button type="button" className="secondary" disabled={!deposit || busy || (!pending && coolingDown)}
          onClick={() => void claim()}>
          {busy ? "Зачекай…" : pending ? "Повторити" : "Отримати"}
        </button>
      </div>
      {notice && <p className="notice result" role="status">{notice}</p>}
      {error && <div className="notice error" role="alert">{error}
        {!deposit && ready && <button type="button" onClick={() => void refresh()}>Оновити</button>}
      </div>}
    </section>
  );
}

export function CasinoStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/stats", { signal: controller.signal });
        if (response.ok) setStats(await response.json());
      } catch {
        // A failed refresh leaves the last available counters visible.
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <section className="help-casino" aria-label="Статистика казино">
      <dl>
        <div><dt>Поповнення гравців</dt><dd>{stats ? cash(stats.deposited) : "—"}</dd></div>
        <div><dt>Програно гравцями</dt><dd>{stats ? cash(stats.lost) : "—"}</dd></div>
        <div className="help-casino-net" data-result={stats && stats.houseNet < 0 ? "loss" : undefined}>
          <dt>Чистий результат казино</dt>
          <dd>{stats ? (stats.houseNet > 0 ? "+" : "") + cash(stats.houseNet) : "—"}</dd>
        </div>
      </dl>
      <p>Усі суми у віртуальних доларах після останнього скидання. Ігрові суми враховують раунди з ботами.</p>
    </section>
  );
}
