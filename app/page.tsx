"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DEFAULT_MODE, lineup, liveOffer, ROULETTE_MODES, roundOffer, totalPot,
  type GameState, type RouletteMode, type Round } from "../lib/game";
import { AvatarBadge, BotFeed, SpinWheel, cash, percent } from "./roulette";
import { ApiError, OFFLINE, request } from "./api-client";
import { AdminPanel } from "./admin-panel";
import { PrivateRooms } from "./private-rooms";
import { CasinoStats, WalletDeposit } from "./player-info";

type Tab = "wheel" | "profile" | "help" | "admin";
type Bet = { round: number; stake: number; requestId: string; mode: RouletteMode };
const modes = Object.keys(ROULETTE_MODES) as RouletteMode[];
const GUEST = { name: "Ви", avatar: 1, color: "#ff75b9" };

function requestGame(mode: RouletteMode, bet?: Bet) {
  return request<GameState>("/api/game?mode=" + mode, bet);
}

function resultMessage(round: Round) {
  if (round.winner === "player") return "Ви виграли " + cash(round.pot - round.stake) + " чистими.";
  const winner = round.participants.find((player) => player.id === round.winner);
  return (winner?.name ?? "Бот") + " забирає банк " + cash(round.pot) + "." +
    (round.stake ? " Ви втратили " + cash(round.stake) + "." : "");
}

const helpText = [
  "Програма була розроблена студентами ФКНК КНУ групи ІПС-11\nСічкарем Євгеном\nГавриленком Денисом\nАнтоненко Іваном",
  'В участі в активності "майже хакатон" та в навчальних цілях\nПрограма не закликає до участі в реальних азартних іграх та не пов\'язана з реальним казино та гемблінгом, всі співпадіння випадкові, стиль за основу взятий з гри GTA6',
  "Бажаємо всім здоров'я та удачі"
];

export default function Betbook() {
  const [tab, setTab] = useState<Tab>("wheel");
  const [roomMode, setRoomMode] = useState(false);
  const [mode, setMode] = useState<RouletteMode>(DEFAULT_MODE);
  const selectedMode = useRef<RouletteMode>(DEFAULT_MODE);
  const [state, setState] = useState<GameState | null>(null);
  const [clock, setClock] = useState(0);
  const [amount, setAmount] = useState("10");
  const [retry, setRetry] = useState<Bet | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [spin, setSpin] = useState<Round | null>(null);
  const [error, setError] = useState("");
  const snapshot = useRef<GameState | null>(null);
  const timeOffset = useRef(0);
  const requestActive = useRef(false);
  const lastRefresh = useRef(0);
  const requiresTelegram = useRef(false);
  const spinTimeout = useRef(0);

  function applyState(next: GameState) {
    const previous = snapshot.current;
    snapshot.current = next;
    timeOffset.current = next.now - Date.now();
    setClock(next.now);
    setState(next);
    if (previous?.offer.mode === next.offer.mode && previous.offer.number < next.offer.number && !document.hidden) {
      window.clearTimeout(spinTimeout.current);
      setSpin(next.latest);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      spinTimeout.current = window.setTimeout(() => setSpin(null), reduced ? 650 : 2650);
    }
  }

  async function refresh() {
    if (requestActive.current) return;
    requestActive.current = true;
    lastRefresh.current = Date.now();
    const requestedMode = selectedMode.current;
    try {
      const next = await requestGame(requestedMode);
      if (requestedMode !== selectedMode.current) return;
      applyState(next);
      requiresTelegram.current = false;
      setError("");
    } catch (failure) {
      if (requestedMode !== selectedMode.current) return;
      requiresTelegram.current = failure instanceof ApiError && failure.status === 401;
      setError(failure instanceof ApiError ? failure.message : OFFLINE);
    } finally {
      requestActive.current = false;
    }
  }

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    void refresh();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const now = Date.now();
      const serverTime = now + timeOffset.current;
      setClock(serverTime);
      const elapsed = now - lastRefresh.current;
      const roundEnded = snapshot.current && serverTime >= snapshot.current.offer.endsAt;
      if (!requiresTelegram.current && (elapsed > 18_000 || (roundEnded && elapsed > 1600))) void refresh();
    }, 500);
    function resume() {
      if (!document.hidden && !requiresTelegram.current) void refresh();
    }
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(spinTimeout.current);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const game = state?.offer.mode === mode ? state : null;
  const offer = useMemo(() => game?.offer ?? roundOffer(1, true, mode), [game, mode]);
  const { min, max, presets } = ROULETTE_MODES[mode];
  const player = useMemo(() => state ? { ...state.profile, name: "Ви" } : GUEST, [state]);
  const balance = state?.profile.balance ?? 0;
  const stake = Number(amount);
  const validStake = Number.isSafeInteger(stake) && stake >= min && stake <= max;
  const placed = game?.bet?.stake ?? 0;
  const placedAt = game?.bet?.placedAt;
  const currentOffer = useMemo(() => game ? liveOffer(offer, placed, clock, placedAt) : { ...offer, bots: [] },
    [game, offer, placed, clock, placedAt]);
  const participants = useMemo(() => lineup(currentOffer, placed, player), [currentOffer, placed, player]);
  const estimated = validStake && clock < offer.endsAt ? lineup(liveOffer(offer, stake, offer.endsAt, clock), stake, player)[0] : null;
  const remaining = game ? Math.max(0, Math.ceil((offer.endsAt - clock) / 1000)) : 0;
  const countdown = game ? Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0") : "—";
  const locked = !game || submitting || !!spin || !!placed || remaining === 0;
  const lastBet = state?.lastBet;
  const isAdmin = !!state?.profile.isAdmin;
  const tabs: [Tab, string, string][] = [["wheel", "Рулетка", "◉"], ["profile", "Профіль", "♙"], ["help", "Довідка", "✦"]];
  if (isAdmin) tabs.push(["admin", "Адмінка", "⚙"]);

  function changeMode(next: RouletteMode) {
    if (next === selectedMode.current || submitting || retry) return;
    selectedMode.current = next;
    setMode(next);
    setAmount(String(ROULETTE_MODES[next].min));
    setError("");
    setSpin(null);
    window.clearTimeout(spinTimeout.current);
    requiresTelegram.current = false;
    lastRefresh.current = 0;
    void refresh();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestActive.current || !game || (!retry && (locked || !validStake || stake > balance))) return;
    requestActive.current = true;
    const bet = retry ?? { round: offer.number, stake, requestId: crypto.randomUUID(), mode };
    setRetry(bet);
    setSubmitting(true);
    setError("");
    try {
      applyState(await requestGame(bet.mode, bet));
      setRetry(null);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) {
        setRetry(null);
        requestActive.current = false;
        if (failure.status === 409 || failure.status === 422) await refresh();
      }
      setError(failure instanceof ApiError ? failure.message : "Повторіть запит, щоб перевірити ставку.");
    } finally {
      setSubmitting(false);
      requestActive.current = false;
    }
  }

  return (
    <div className="shell">
      <header className="header">
        <a className="wordmark" href="#" onClick={(event) => { event.preventDefault(); setTab("wheel"); }} aria-label="Betbook — відкрити рулетку">
          BET<span>BOOK</span>
        </a>
        <div className="wallet"><span>Віртуальний баланс</span><strong>{state ? cash(balance) : "—"}</strong></div>
      </header>
      <main>
        {tab === "wheel" && (
          <>
            <WalletDeposit ready={!!state} onDeposit={() => void refresh()} />
            <div className="game-modes" role="group" aria-label="Режим рулетки">
              <button type="button" className="secondary" aria-pressed={!roomMode} onClick={() => setRoomMode(false)}>З ботами</button>
              <button type="button" className="secondary" aria-pressed={roomMode} onClick={() => setRoomMode(true)}>З друзями</button>
            </div>
            {roomMode ? <PrivateRooms onBalanceChanged={() => void refresh()} /> : <>
            <div className="game-modes roulette-stakes" role="group" aria-label="Ліміти ставок">
              {modes.map((option) => (
                <button type="button" className="secondary" key={option} aria-pressed={mode === option}
                  disabled={submitting || !!retry} onClick={() => changeMode(option)}>
                  {ROULETTE_MODES[option].min}–{ROULETTE_MODES[option].max} $
                </button>
              ))}
            </div>
            <BotFeed feed={game?.feed ?? []} />
            <section className="arena" aria-labelledby="arena-title">
              <div className="wheel-area">
                <div className="arena-heading">
                  <h1 id="arena-title">Рулетка</h1>
                  <div className="countdown"><span>{spin ? "Розіграш" : "До розіграшу"}</span><strong>{countdown}</strong></div>
                </div>
                <SpinWheel players={participants} spin={spin} />
                <div className="pot"><span>Банк раунду</span><strong>{cash(spin?.pot ?? totalPot(currentOffer, placed))}</strong></div>
              </div>
              <div className="bet-area">
                <form onSubmit={submit}>
                  <label htmlFor="stake">Віртуальна ставка · {min}–{max} $</label>
                  <div className="input-wrap">
                    <input id="stake" type="text" inputMode="numeric" autoComplete="off" value={placed ? String(placed) : amount}
                      onChange={(event) => { if (/^\d{0,3}$/.test(event.target.value)) setAmount(event.target.value); }}
                      disabled={locked || !!retry} />
                    <span>$</span>
                  </div>
                  <div className="chips" aria-label="Розмір ставки">
                    {presets.map((value) => (
                      <button type="button" key={value} disabled={balance < value || locked || !!retry}
                        aria-pressed={Number(amount) === value} onClick={() => setAmount(String(value))}>{cash(value)}</button>
                    ))}
                    {balance >= min && balance < max && !presets.some((value) => value === balance) && (
                      <button type="button" disabled={locked || !!retry} onClick={() => setAmount(String(balance))}>Увесь баланс</button>
                    )}
                  </div>
                  {estimated && game && !placed && (
                    <p className="odds"><span>На момент розіграшу</span><span>Частка <strong>{percent(estimated.share)}</strong></span><span>Шанс <strong>{percent(estimated.chance)}</strong></span></p>
                  )}
                  <button className="primary" disabled={submitting || (!retry && (locked || !validStake || stake > balance))}>
                    {submitting ? "Приймаємо ставку…" : retry ? "Повторити запит" : placed ? "Ставку прийнято" : "Зробити ставку"}
                  </button>
                </form>
                {state && !balance && !placed && <p className="notice">Поповни баланс, щоб зробити ставку.</p>}
                {state && !placed && balance > 0 && stake > balance && <p className="notice">Ставка перевищує віртуальний баланс.</p>}
                {game && !placed && amount && !validStake && <p className="notice">Допустима ставка від {min} до {max} $.</p>}
                {!game && !error && <p className="notice" role="status">Завантажуємо гру…</p>}
                {error && <div className="notice error" role="alert">{error}<button type="button" onClick={() => void refresh()}>Оновити</button></div>}
                {game?.latest && <p className="notice result" role="status">{resultMessage(game.latest)}</p>}
              </div>
            </section>
            <section className="entries" aria-labelledby="entries-title">
              <h2 id="entries-title">Учасники раунду</h2>
              <p>Кожен бот робить одну ставку протягом раунду.</p>
              {!spin && !participants.length && <p>Чекаємо на перші ставки.</p>}
              <div className="entry-table">
                <table>
                  <thead><tr><th>Гравець</th><th>Ставка</th><th>Частка банку</th><th>Шанс</th></tr></thead>
                  <tbody>
                    {(spin?.participants ?? participants).map((entry) => (
                      <tr key={entry.id}>
                        <th scope="row">
                          <span className="participant">
                            <AvatarBadge identity={entry} /><span>{entry.name}{entry.id !== "player" && <small>БОТ</small>}</span>
                          </span>
                        </th>
                        <td>{cash(entry.stake)}</td><td>{percent(entry.share)}</td><td className="chance">{percent(entry.chance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            </>}
          </>
        )}
        {tab === "profile" && (
          <section className="info-page">
            <h1>Профіль</h1>
            {state && <p className="profile-name participant"><AvatarBadge identity={state.profile} />{state.profile.name}</p>}
            <dl className="stats">
              <div><dt>Віртуальний баланс</dt><dd>{state ? cash(balance) : "—"}</dd></div>
              <div><dt>Чистий програш</dt><dd>{state ? cash(state.profile.netLoss) : "—"}</dd></div>
              <div><dt>Зіграно раундів</dt><dd>{state?.profile.rounds ?? "—"}</dd></div>
            </dl>
            {lastBet && <p>Остання ставка. {resultMessage(lastBet)}</p>}
            <p>Чистий програш враховує лише ставки й виплати за завершеними раундами.</p>
          </section>
        )}
        {tab === "help" && (
          <>
            <section className="info-page">
              <h1>Довідка</h1>
              {helpText.map((part) => <p className="credits-copy" key={part}>{part}</p>)}
            </section>
            <CasinoStats />
          </>
        )}
        {tab === "admin" && isAdmin && <AdminPanel onBalanceUpdated={() => void refresh()} />}
      </main>
      <nav className={"tabs" + (isAdmin ? " with-admin" : "")} aria-label="Розділи Betbook">
        {tabs.map(([key, label, icon]) => (
          <button type="button" key={key} aria-current={tab === key ? "page" : undefined}
            onClick={() => { setTab(key); window.scrollTo(0, 0); }}>
            <span aria-hidden="true" className="tab-icon">{icon}</span>{label}
          </button>
        ))}
      </nav>
    </div>
  );
}
