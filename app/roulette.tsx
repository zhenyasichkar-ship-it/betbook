"use client";

import { memo, useEffect, useState, type CSSProperties } from "react";
import type { Avatar, GameState, Participant, Round } from "../lib/game";

const currency = new Intl.NumberFormat("uk-UA");
const percentage = new Intl.NumberFormat("uk-UA", { style: "percent", maximumFractionDigits: 2 });
export const cash = (value: number) => currency.format(value) + " $";
export const percent = (value: number) => percentage.format(value);

export function AvatarBadge({ identity }: { identity: Avatar }) {
  const pixels = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (!((identity.avatar >>> (y * 3 + x)) & 1)) continue;
      pixels.push("M" + (x + 1) + " " + (y + 1) + "h1v1h-1z");
      if (x < 2) pixels.push("M" + (5 - x) + " " + (y + 1) + "h1v1h-1z");
    }
  }
  return (
    <svg aria-hidden="true" className="avatar" viewBox="0 0 7 7" style={{ "--participant-color": identity.color } as CSSProperties}>
      <path d={pixels.join("") || "M3 2h1v3H3z"} fill="currentColor" />
    </svg>
  );
}

export const SpinWheel = memo(function SpinWheel({ players, spin }: { players: Participant[]; spin: Round | null }) {
  const visible = spin?.participants ?? players;
  const minArc = 12;
  let angle = 0;
  const sectors = visible.map((participant) => {
    const from = angle;
    angle += minArc + participant.share * (360 - minArc * visible.length);
    return { participant, from, to: angle, middle: (from + angle) / 2 };
  });
  const gradient = sectors.map(({ participant, from, to }) => participant.color + " " + from + "deg " + to + "deg").join(", ");
  const winner = sectors.find(({ participant }) => participant.id === spin?.winner);
  const rotation = winner ? 2160 - winner.middle : 0;
  return (
    <div className="wheel-frame" aria-hidden="true">
      <div className="pointer" />
      <div key={spin?.number ?? "active"} className={"wheel-rotor" + (spin ? " spinning" : "")}
        style={{ backgroundImage: gradient ? "conic-gradient(" + gradient + ")" : undefined,
          "--finish-angle": rotation + "deg" } as CSSProperties}>
        <div className="wheel-rings" />
        {sectors.map(({ participant, middle }) => {
          const radians = middle * Math.PI / 180;
          return (
            <span className="wheel-avatar" key={participant.id} style={{
              left: 50 + 39 * Math.sin(radians) + "%",
              top: 50 - 39 * Math.cos(radians) + "%"
            }}>
              <AvatarBadge identity={participant} />
            </span>
          );
        })}
      </div>
      <div className="wheel-center"><span>BB</span></div>
    </div>
  );
});

export function BotFeed({ feed }: { feed: GameState["feed"] }) {
  const [position, setPosition] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setPosition((previous) => previous + 1);
    }, 3600);
    return () => window.clearInterval(timer);
  }, []);
  const item = feed[position % feed.length];
  return (
    <section className="feed" aria-label="Виграші ботів">
      <h2><span aria-hidden="true">✦</span> Виграші ботів</h2>
      {item ? (
        <div className="feed-card" key={item.key}>
          <AvatarBadge identity={item} /><span>{item.name}</span><strong>{cash(item.pot)}</strong>
        </div>
      ) : <p>Чекаємо на результати…</p>}
    </section>
  );
}
