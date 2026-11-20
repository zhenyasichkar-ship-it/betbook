"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { BOTS, DAILY_BONUS, INTRO_ROUNDS, lineup, roundOffer, totalPot, type GameState, type Participant } from "../lib/game";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready(): void; expand(): void } };
  }
}

const cashFormat = new Intl.NumberFormat("ru-RU");
const percentFormat = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 });
const cash = (value: number) => cashFormat.format(value) + " $";
const percent = (value: number) => percentFormat.format(value);

type Tab = "wheel" | "profile" | "credits";
type Bet = { round: number; stake: number; requestId: string };

class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function requestGame(bet?: Bet): Promise<GameState> {
  const initData = window.Telegram?.WebApp?.initData;
  const headers = new Headers();
  if (initData) headers.set("Authorization", "tma " + initData);
  if (bet) headers.set("Content-Type", "application/json");
  const response = await fetch("/api/game", {
    method: bet ? "POST" : "GET",
    headers,
    body: bet ? JSON.stringify(bet) : undefined,
    cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.error ?? "Не удалось связаться с Betbook.", response.status);
  }
  return response.json();
}

function SymbolMark({ name }: { name: Tab }) {
  const symbols = { wheel: "◉", profile: "♙", credits: "✦" };
  return <span aria-hidden="true" className="tab-icon">{symbols[name]}</span>;
}

function SpinWheel({ players, angle, spinning }: { players: Participant[]; angle: number; spinning: boolean }) {
  let position = 0;
  const stops = players.filter((player) => player.share > 0).map((player) => {
    const from = position;
    position += player.share * 360;
    return player.color + " " + from + "deg " + position + "deg";
  });
  return (
    <div className="wheel-frame" aria-hidden="true">
      <div className="pointer" />
      <div className={"wheel-rotor" + (spinning ? " spinning" : "")} style={{
        transform: "rotate(" + angle + "deg)",
        backgroundImage: "conic-gradient(" + stops.join(", ") + ")"
      }}>
        <div className="wheel-rings" />
      </div>
      <div className="wheel-center"><span>BB</span></div>
    </div>
  );
}

function BotFeed({ feed }: { feed: GameState["feed"] }) {
  return (
    <section className="feed" aria-label="Выигрыши ботов">
      <h2><span aria-hidden="true">✦</span> Выигрыши ботов</h2>
      {feed.length ? (
        <ul>
          {feed.map((item, index) => (
            <li key={index}>
              <span>{BOTS.find((bot) => bot.id === item.bot)?.name}</span><strong>{cash(item.pot)}</strong>
            </li>
          ))}
        </ul>
      ) : <p>Здесь появятся крупнейшие выигрыши ботов из последних раундов.</p>}
    </section>
  );
}

const credits = [
  "Програма була розроблена студентами ФКНК КНУ групи ІПС-11\nСічкарем Євгеном\nГавриленком Денисом\nта Антоненко Іваном",
  'в участі в активності "майже хакатон" та в навчальних цілях\nПрограма не пов\'язана з реальним казино та гемблінгом, всі співпадіння випадкові, стиль за основу взятий з гри GTA6\nБажаємо всім здоровя та удачі'
];

export default function Betbook() {
  const [tab, setTab] = useState<Tab>("wheel");
  const [state, setState] = useState<GameState | null>(null);
  const [amount, setAmount] = useState("10");
  const [pending, setPending] = useState<Bet | null>(null);
  const [busy, setBusy] = useState(false);
  const [angle, setAngle] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestActive = useRef(false);

  async function reload() {
    setError("");
    try {
      const next = await requestGame();
      setState(next);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Связь прервана. Проверьте подключение.");
    }
  }

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    void reload();
  }, []);

  const offer = state?.offer ?? roundOffer(1);
  const stake = pending?.stake ?? Number(amount);
  const validStake = Number.isSafeInteger(stake) && stake > 0;
  const displayStake = validStake ? stake : 0;
  const participantList = lineup(offer, displayStake);
  const balance = state?.profile.balance ?? 0;
  const latest = state?.latest;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestActive.current || !state || (!pending && (!validStake || stake > balance))) return;
    requestActive.current = true;
    const bet = pending ?? { round: offer.number, stake, requestId: crypto.randomUUID() };
    setPending(bet);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await requestGame(bet);
      const round = next.latest;
      if (!round) throw new Error("Missing round");
      const index = round.participants.findIndex((player) => player.id === round.winner);
      const winner = round.participants[index];
      const start = round.participants.slice(0, index).reduce((total, player) => total + player.share, 0);
      const center = (start + winner.share / 2) * 360;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setAngle(2160 - center);
      if (!reduced) await new Promise((done) => setTimeout(done, 2350));
      setState(next);
      setMessage(winner.id === "player"
        ? "Вы выиграли " + cash(round.pot - round.stake) + " чистыми."
        : winner.name + " забирает банк " + cash(round.pot) + ". Вы потеряли " + cash(round.stake) + ".");
      setPending(null);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) {
        setPending(null);
        if (failure.status === 409 || failure.status === 422) await reload();
      }
      setError(failure instanceof ApiError ? failure.message : "Связь прервана. Повторите ставку, чтобы получить результат.");
    } finally {
      setAngle(0);
      setBusy(false);
      requestActive.current = false;
    }
  }

  return (
    <div className="shell">
      <header className="header">
        <a className="wordmark" href="#" onClick={(event) => { event.preventDefault(); setTab("wheel"); }} aria-label="Betbook — открыть рулетку">
          BET<span>BOOK</span>
        </a>
        <div className="wallet"><span>Виртуальный баланс</span><strong>{state ? cash(balance) : "—"}</strong></div>
      </header>
      <main>
        {tab === "wheel" && (
          <>
            <BotFeed feed={state?.feed ?? []} />
            <section className="arena" aria-labelledby="arena-title">
              <div className="wheel-area">
                <div className="arena-heading">
                  <h1 id="arena-title">PvP-рулетка</h1><span>Раунд {offer.number}</span>
                </div>
                <SpinWheel players={participantList} angle={angle} spinning={busy} />
                <div className="pot"><span>Банк раунда</span><strong>{cash(totalPot(offer, displayStake))}</strong></div>
              </div>
              <div className="bet-area">
                <div className="mode">
                  <strong>Демо подкрученной рулетки</strong>
                  <p>{offer.number <= INTRO_ROUNDS
                    ? "Первые " + INTRO_ROUNDS + " раунда гарантированно выигрывает игрок."
                    : "Боты получают преимущество. Даже большая доля банка не гарантирует выигрыш."}</p>
                </div>
                <form onSubmit={submit}>
                  <label htmlFor="stake">Виртуальная ставка</label>
                  <div className="input-wrap">
                    <input id="stake" type="text" inputMode="numeric" autoComplete="off" value={amount}
                      onChange={(event) => { if (/^\d{0,15}$/.test(event.target.value)) setAmount(event.target.value); }}
                      disabled={!state || busy || !!pending} />
                    <span>$</span>
                  </div>
                  <div className="chips" aria-label="Размер ставки">
                    {[5, 10, 25].map((value) => (
                      <button type="button" key={value} disabled={balance < value || busy || !!pending}
                        aria-pressed={Number(amount) === value} onClick={() => setAmount(String(value))}>{cash(value)}</button>
                    ))}
                    <button type="button" disabled={balance < 1 || busy || !!pending}
                      onClick={() => setAmount(String(balance))}>Весь баланс</button>
                  </div>
                  <button className="primary" disabled={busy || !state || (!pending && (!validStake || stake > balance))}>
                    {busy ? "Розыгрыш…" : pending ? "Повторить запрос" : "Внести ставку"}
                  </button>
                </form>
                {state && !balance && !pending && <p className="notice">Следующий бонус доступен с полуночи по Киеву.</p>}
                {state && !pending && balance > 0 && stake > balance && <p className="notice">Ставка превышает виртуальный баланс.</p>}
                {!state && !error && <p className="notice" role="status">Загружаем игру…</p>}
                {error && <div className="notice error" role="alert">{error}{!state && <button type="button" onClick={() => void reload()}>Обновить</button>}</div>}
                {message && <p className="notice result" role="status">{message}</p>}
                {latest && !message && <p className="notice">Раунд {latest.number} · {latest.participants.find((player) => player.id === latest.winner)?.name} · {cash(latest.pot)}</p>}
              </div>
            </section>
            <section className="entries" aria-labelledby="entries-title">
              <h2 id="entries-title">Участники раунда</h2>
              <div className="entry-table">
                <table>
                  <thead><tr><th>Игрок</th><th>Ставка</th><th>Доля банка</th><th>Шанс</th></tr></thead>
                  <tbody>
                    {participantList.map((player) => (
                      <tr key={player.id}>
                        <th scope="row">
                          <span className="participant" style={{ "--participant-color": player.color } as CSSProperties}>
                            <span className="avatar" aria-hidden="true">{player.initials}</span><span>{player.name}{player.id !== "player" && <small>БОТ</small>}</span>
                          </span>
                        </th>
                        <td>{cash(player.stake)}</td><td>{percent(player.share)}</td><td className="chance">{percent(player.chance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {tab === "profile" && (
          <section className="info-page">
            <h1>Профиль</h1>
            <p className="profile-name">{state?.profile.name ?? "Игрок"}</p>
            <dl className="stats">
              <div><dt>Виртуальный баланс</dt><dd>{state ? cash(balance) : "—"}</dd></div>
              <div><dt>Чистый проигрыш</dt><dd>{state ? cash(state.profile.netLoss) : "—"}</dd></div>
              <div><dt>Сыграно раундов</dt><dd>{state?.profile.rounds ?? "—"}</dd></div>
            </dl>
            <p>Чистый проигрыш — ставки за вычетом выплат. Бонусы в расчёт не входят.</p>
            <p>Ежедневный бонус {cash(DAILY_BONUS)} начисляется при входе. Новый день начинается в 00:00 по Киеву.</p>
          </section>
        )}
        {tab === "credits" && (
          <section className="info-page" lang="uk">
            <h1>Кредити</h1>
            {credits.map((part) => <p className="credits-copy" key={part}>{part}</p>)}
          </section>
        )}
      </main>
      <nav className="tabs" aria-label="Разделы Betbook">
        {([["wheel", "Рулетка"], ["profile", "Профиль"], ["credits", "Кредиты"]] as const).map(([key, label]) => (
          <button type="button" key={key} aria-current={tab === key ? "page" : undefined}
            onClick={() => { setTab(key); window.scrollTo(0, 0); }}>
            <SymbolMark name={key} />{label}
          </button>
        ))}
      </nav>
    </div>
  );
}
