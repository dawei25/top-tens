import { useEffect, useRef } from "react";
import { archive, type DailyEntry } from "../game/daily";
import type { PuzzleMeta } from "../game/puzzles";
import { load } from "../game/storage";
import type { GameState } from "../game/state";
import { BackArrow, formatAsOf } from "./pixel";

interface Props {
  index: PuzzleMeta[];
  schedule: DailyEntry[];
  today: string;
  onHome: () => void;
}

function result(g?: GameState): { text: string; tone: string } {
  if (!g) return { text: "not played", tone: "faint" };
  if (g.status === "playing") return { text: `playing ${g.found.length}/10`, tone: "cyan" };
  if (g.status === "gave-up") return { text: `gave up ${g.found.length}/10`, tone: "muted" };
  return { text: `${g.found.length}/10`, tone: g.status === "won" ? "gold" : "text" };
}

/** Every daily so far, newest first. Old ones play like any list but don't count toward streaks. */
export function Archive({ index, schedule, today, onHome }: Props) {
  const saved = load();
  const list = archive(schedule, today);
  const firstRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => firstRef.current?.focus({ preventScroll: true }), []);

  return (
    <main className="screen archive">
      <header className="game-head">
        <button className="key key-icon" onClick={onHome} aria-label="Home">
          <BackArrow />
        </button>
        <div className="game-head-mid">
          <span className="label mode">Archive</span>
        </div>
        <span className="key-sm-spacer" aria-hidden="true" />
      </header>

      <section className="panel prompt">
        <h1>Past dailies</h1>
        <p className="caption">every daily so far. replays don't count toward your streak.</p>
      </section>

      <ol className="panel arch-list">
        {list.map((e, i) => {
          const r = result(saved.games[e.id]);
          const isToday = e.date === today;
          return (
            <li key={e.date}>
              <a ref={i === 0 ? firstRef : undefined} className={`arch-row ${isToday ? "today" : ""}`} href={`#daily-${e.date}`}>
                <span className="arch-n">#{e.n}</span>
                <span className="arch-date">{formatAsOf(e.date).replace(/, \d{4}$/, "")}</span>
                <span className="arch-title">
                  {index.find((p) => p.id === e.id)?.title ?? e.id}
                  {isToday && <span className="arch-tag">today</span>}
                </span>
                <span className={`arch-result ${r.tone}`}>{r.text}</span>
              </a>
            </li>
          );
        })}
        {list.length === 0 && <li className="arch-empty caption">no dailies yet.</li>}
      </ol>
    </main>
  );
}
