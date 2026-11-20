"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Round } from "../lib/game";
import { ROOM_LIMIT, type RoomState, type RoomSummary } from "../lib/room-types";
import { ApiError, OFFLINE, request } from "./api-client";
import { AvatarBadge, SpinWheel, cash, percent } from "./roulette";

const route = "/api/room";

export function PrivateRooms({ onBalanceChanged }: { onBalanceChanged(): void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return selected
    ? <ActiveRoom key={selected} code={selected} onBack={() => setSelected(null)} onBalanceChanged={onBalanceChanged} />
    : <RoomLobby onOpen={setSelected} onBalanceChanged={onBalanceChanged} />;
}

function RoomLobby({ onOpen, onBalanceChanged }: { onOpen(code: string): void; onBalanceChanged(): void }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minimum, setMinimum] = useState("1");
  const [maximum, setMaximum] = useState("1000");
  const minStake = Number(minimum);
  const maxStake = Number(maximum);
  const validLimits = Number.isSafeInteger(minStake) && Number.isSafeInteger(maxStake) && minStake >= 1 && maxStake >= minStake;
  const creation = useRef<{ action: "create"; requestId: string; minStake: number; maxStake: number } | null>(null);
  const active = useRef(false);

  async function load() {
    try {
      setRooms((await request<{ rooms: RoomSummary[] }>(route)).rooms);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : OFFLINE);
    }
  }
  useEffect(() => { void load(); }, []);

  async function enter(action: "create" | "join") {
    if (active.current || (action === "create" && !validLimits)) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "create" && (creation.current?.minStake !== minStake || creation.current?.maxStake !== maxStake)) {
        creation.current = { action, requestId: crypto.randomUUID(), minStake, maxStake };
      }
      const payload = action === "create" ? creation.current! : { action, code: invite };
      const room = await request<{ code: string }>(route, payload);
      creation.current = null;
      onBalanceChanged();
      onOpen(room.code);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500 && action === "create") creation.current = null;
      setError(failure instanceof ApiError ? failure.message : OFFLINE);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="info-page rooms-lobby">
      <h1>Приватні кімнати</h1>
      <p>Поділися кодом із друзями. У кімнаті грають лише люди, і всі бачать один результат.</p>
      <form className="room-creation" onSubmit={(event) => { event.preventDefault(); void enter("create"); }}>
        <div>
          <label htmlFor="room-min">Мінімальна ставка ($)</label>
          <div className="input-wrap"><input id="room-min" value={minimum} inputMode="numeric" autoComplete="off"
            onChange={(event) => { if (/^\d{0,16}$/.test(event.target.value)) setMinimum(event.target.value); }} /></div>
        </div>
        <div>
          <label htmlFor="room-max">Максимальна ставка ($)</label>
          <div className="input-wrap"><input id="room-max" value={maximum} inputMode="numeric" autoComplete="off"
            onChange={(event) => { if (/^\d{0,16}$/.test(event.target.value)) setMaximum(event.target.value); }} /></div>
        </div>
        {!validLimits && <p className="notice">Вкажи цілий мінімум від 1 $ і максимум, не менший за мінімум.</p>}
        <button className="primary" disabled={busy || !validLimits}>Створити кімнату</button>
      </form>
      <form onSubmit={(event) => { event.preventDefault(); void enter("join"); }}>
        <div>
          <label htmlFor="room-invite">Код запрошення</label>
          <div className="input-wrap"><input id="room-invite" value={invite} placeholder="10 символів" autoComplete="off"
            maxLength={10} onChange={(event) => setInvite(event.target.value.toUpperCase())} /></div>
        </div>
        <button className="secondary" disabled={busy || !/^[A-F0-9]{10}$/.test(invite.trim())}>Приєднатися</button>
      </form>
      {error && <p className="notice error" role="alert">{error}</p>}
      {rooms && rooms.length > 0 && (
        <div className="room-list">
          <h2>Ваші кімнати</h2>
          {rooms.map((room) => (
            <button type="button" className="secondary" key={room.code} disabled={busy} onClick={() => onOpen(room.code)}>
              <span>{room.code}</span><span>{room.members} / {ROOM_LIMIT}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ActiveRoom({ code, onBack, onBalanceChanged }: { code: string; onBack(): void; onBalanceChanged(): void }) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [clock, setClock] = useState(0);
  const [amount, setAmount] = useState("10");
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [spin, setSpin] = useState<Round | null>(null);
  type RoomBet = { action: "bet"; round: number; stake: number; code: string; requestId: string };
  const [retry, setRetry] = useState<RoomBet | null>(null);
  const state = useRef<RoomState | null>(null);
  const active = useRef(false);
  const lastSync = useRef(0);
  const offset = useRef(0);
  const spinTimer = useRef(0);
  const stopped = useRef(false);

  function apply(next: RoomState) {
    const previous = state.current;
    state.current = next;
    offset.current = next.now - Date.now();
    setRoom(next);
    setClock(next.now);
    if (!previous && (next.minStake > 10 || next.maxStake < 10)) setAmount(String(next.minStake));
    if (previous && next.balance !== previous.balance) onBalanceChanged();
    if (previous && next.latest?.winner && next.latest.number >= previous.number && next.number > previous.number) {
      setSpin({ ...next.latest, winner: next.latest.winner, stake: 0 });
      window.clearTimeout(spinTimer.current);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      spinTimer.current = window.setTimeout(() => setSpin(null), reduced ? 650 : 2650);
    }
  }

  async function refresh() {
    if (active.current) return;
    active.current = true;
    lastSync.current = Date.now();
    try {
      apply(await request<RoomState>(route + "?code=" + code));
      setError("");
    } catch (failure) {
      stopped.current = failure instanceof ApiError && (failure.status === 401 || failure.status === 404);
      if (stopped.current) setRoom(null);
      setError(failure instanceof ApiError ? failure.message : OFFLINE);
    } finally {
      active.current = false;
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const now = Date.now();
      setClock(now + offset.current);
      const ended = state.current && now + offset.current >= state.current.endsAt;
      if (!stopped.current && now - lastSync.current >= (ended ? 1000 : 2800)) void refresh();
    }, 500);
    const resume = () => { if (!document.hidden && !stopped.current) void refresh(); };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(spinTimer.current);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const stake = Number(amount);
  const valid = Number.isSafeInteger(stake) && !!room && stake >= room.minStake && stake <= room.maxStake;
  const remaining = room ? Math.max(0, Math.ceil((room.endsAt - clock) / 1000)) : 0;
  const countdown = room ? Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0") : "—";
  const locked = !room || !!room.stake || !remaining || !!spin || submitting || deleting;
  const latest = room?.latest;
  const winner = latest?.participants.find((entry) => entry.id === latest.winner);
  const result = latest?.winner
    ? (winner?.id === room?.selfId ? "Ви виграли " : (winner?.name ?? "Гравець") + " виграв(-ла) ") + cash(latest.pot) + "."
    : latest ? "Ставку повернено: у раунді був лише один гравець." : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!room || active.current || (!retry && (locked || !valid || stake > room.balance))) return;
    active.current = true;
    setSubmitting(true);
    setError("");
    const bet = retry ?? { action: "bet", round: room.number, stake, code, requestId: crypto.randomUUID() };
    setRetry(bet);
    try {
      apply(await request<RoomState>(route, bet));
      setRetry(null);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) setRetry(null);
      setError(failure instanceof ApiError ? failure.message : "Повторіть запит, щоб перевірити ставку.");
    } finally {
      active.current = false;
      setSubmitting(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyMessage("Код скопійовано.");
    } catch {
      setCopyMessage("Виділи код і скопіюй його.");
    }
  }

  async function removeRoom() {
    if (active.current || !room?.canDelete) return;
    active.current = true;
    setDeleting(true);
    setError("");
    try {
      await request<{ deleted: boolean }>(route, { action: "delete", code });
      onBalanceChanged();
      onBack();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : OFFLINE);
    } finally {
      setDeleting(false);
      active.current = false;
    }
  }

  return (
    <>
      <section className="info-page room-invite">
        <div className="room-invite-top"><button className="secondary" type="button" onClick={onBack}>До кімнат</button>
          <button className="secondary" type="button" onClick={() => void copy()}>Копіювати код</button></div>
        <h1>Кімната <span>{code}</span></h1>
        <p>Учасники {room ? room.members + " / " + ROOM_LIMIT : "—"} · Для розіграшу потрібні дві ставки.</p>
        {room && <p>Ліміти ставки {cash(room.minStake)} — {room.maxStake === Number.MAX_SAFE_INTEGER ? "без обмеження" : cash(room.maxStake)}</p>}
        {copyMessage && <p role="status">{copyMessage}</p>}
        {room?.canDelete && (
          <div className="room-actions">
            {confirmDelete ? (
              <>
                <p>Кімната закриється для всіх. Ставки незавершеного раунду повернуться гравцям.</p>
                <button className="secondary danger" type="button" disabled={submitting || deleting}
                  onClick={() => void removeRoom()}>{deleting ? "Видаляємо…" : "Підтвердити видалення"}</button>
                <button className="secondary" type="button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Скасувати</button>
              </>
            ) : <button className="secondary danger" type="button" onClick={() => setConfirmDelete(true)}>Видалити кімнату</button>}
          </div>
        )}
      </section>
      <section className="arena">
        <div className="wheel-area">
          <div className="arena-heading"><h2>Спільний раунд</h2><div className="countdown"><span>До розіграшу</span><strong>{countdown}</strong></div></div>
          <SpinWheel players={room?.participants ?? []} spin={spin} />
          <div className="pot"><span>Банк раунду</span><strong>{cash(spin?.pot ?? room?.pot ?? 0)}</strong></div>
        </div>
        <div className="bet-area">
          <form onSubmit={submit}>
            <label htmlFor="room-stake">Ставка · {room ? cash(room.balance) + " доступно" : "—"}</label>
            <div className="input-wrap">
              <input id="room-stake" inputMode="numeric" value={room?.stake ? String(room.stake) : amount}
                disabled={locked || !!retry} onChange={(event) => { if (/^\d{0,16}$/.test(event.target.value)) setAmount(event.target.value); }} />
              <span>$</span>
            </div>
            <div className="chips">
              {[5, 10, 25].map((chip) => <button key={chip} type="button"
                disabled={locked || !!retry || !room || chip > room.balance || chip < room.minStake || chip > room.maxStake}
                onClick={() => setAmount(String(chip))}>{cash(chip)}</button>)}
            </div>
            <button className="primary" disabled={!room || submitting || deleting || (!retry && (locked || !valid || stake > room.balance))}>
              {submitting ? "Приймаємо ставку…" : retry ? "Повторити запит" : room?.stake ? "Ставку прийнято" : "Зробити ставку"}
            </button>
          </form>
          {room && !room.stake && stake > room.balance && <p className="notice">Ставка перевищує баланс.</p>}
          {room && !room.stake && amount && !valid && <p className="notice">Ставка має бути в межах лімітів кімнати.</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
          {result && <p className="notice result" role="status">{result}</p>}
        </div>
      </section>
      <section className="entries">
        <h2>Ставки в кімнаті</h2>
        {(spin?.participants ?? room?.participants ?? []).length > 0 ? (
          <div className="entry-table">
            <table>
              <thead><tr><th>Гравець</th><th>Ставка</th><th>Шанс</th></tr></thead>
              <tbody>{(spin?.participants ?? room?.participants ?? []).map((entry) => (
                <tr key={entry.id}><th scope="row"><span className="participant"><AvatarBadge identity={entry} />
                  <span>{entry.id === room?.selfId ? "Ви" : entry.name}</span></span></th>
                  <td>{cash(entry.stake)}</td><td className="chance">{percent(entry.chance)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p>У цьому раунді ще немає ставок.</p>}
      </section>
    </>
  );
}
