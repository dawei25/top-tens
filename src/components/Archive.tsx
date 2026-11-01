import { useEffect, useRef } from "react";
import { archive, dailyGame, type DailyEntry } from "../game/daily";
import type { PuzzleMeta } from "../game/puzzles";
import { load } from "../game/storage";
import type { GameState } from "../game/state";
import { ScreenHead, formatAsOf } from "./pixel";

interface Props {
  index: PuzzleMeta[];
  schedule: DailyEntry[];
  today: string;
  onBack: () => void;
  onHome: () => void;
}

function result(g?: GameState): { text: string; tone: string } {
  if (!g) return { text: "not played", tone: "faint" };
  if (g.status === "playing") return { text: `playing ${g.found.length}/10`, tone: "cyan" };
  if (g.status === "gave-up") return { text: `gave up ${g.found.length}/10`, tone: "muted" };
  return { text: `${g.found.length}/10`, tone: g.status === "won" ? "gold" : "text" };
}

/** Every daily so far, newest first. Each is one try; old ones played late don't count toward streaks. */
export function Archive({ index, schedule, today, onBack, onHome }: Props) {
  const saved = load();
  const list = archive(schedule, today);
  const firstRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => firstRef.current?.focus({ preventScroll: true }), []);

  return (
    <main className="screen archive">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Archive</span>
      </ScreenHead>

      <section data-glass className="panel prompt">
        <h1>Past dailies</h1>
        <p className="caption">every daily so far. one try each. late plays don't count toward your streak.</p>
      </section>

      <ol data-glass className="panel arch-list">
        {list.map((e, i) => {
          const r = result(dailyGame(saved, e));
          const isToday = e.date === today;
          // That date's Blitz score. Older dates ran their Blitz on another list: that one is named, so the score never
          // reads as a Blitz of this row's list.
          const blitz = saved.blitzDaily?.[e.date];
          const blitzTitle = blitz && blitz.id !== e.id ? (index.find((p) => p.id === blitz.id)?.title ?? blitz.id) : undefined;
          return (
            <li key={e.date}>
              <a ref={i === 0 ? firstRef : undefined} className={`arch-row ${isToday ? "today" : ""}`} data-testid="archive-row" data-date={e.date} href={`#daily-${e.date}`}>
                <span className="arch-n">#{e.n}</span>
                <span className="arch-date">{formatAsOf(e.date).replace(/, \d{4}$/, "")}</span>
                <span className="arch-title">
                  {index.find((p) => p.id === e.id)?.title ?? e.id}
                  {isToday && <span className="arch-tag">today</span>}
                  {blitz && blitzTitle && (
                    <small className="arch-blitz other" data-testid="archive-blitz" data-list={blitz.id} data-score={blitz.score}>
                      blitz: {blitzTitle} <b>{blitz.score}</b>
                    </small>
                  )}
                </span>
                <span className={`arch-result ${r.tone}`}>
                  {r.text}
                  {blitz && !blitzTitle && (
                    <small className="arch-blitz" data-testid="archive-blitz" data-list={blitz.id} data-score={blitz.score}>
                      blitz {blitz.score}
                    </small>
                  )}
                </span>
              </a>
            </li>
          );
        })}
        {list.length === 0 && <li className="arch-empty caption">no dailies yet.</li>}
      </ol>
    </main>
  );
}
