import { useEffect, useRef } from "react";
import { archive, blitzOfTheDay, dailyGame, type DailyEntry } from "../game/daily";
import type { PuzzleMeta } from "../game/puzzles";
import { load, type DailyBlitzResult } from "../game/storage";
import type { GameState } from "../game/state";
import { ModeTag, ScreenHead, formatAsOf } from "./pixel";

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

function blitzResult(r?: DailyBlitzResult): { text: string; tone: string } {
  return r ? { text: `${r.score} pts`, tone: "gold" } : { text: "not played", tone: "faint" };
}

/**
 * Every daily so far, newest first: each date's list, and under it that date's Blitz (another list). Each is one try;
 * old ones played late don't count toward streaks.
 */
export function Archive({ index, schedule, today, onBack, onHome }: Props) {
  const saved = load();
  const list = archive(schedule, today);
  const title = (id: string) => index.find((p) => p.id === id)?.title ?? id;
  const firstRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => firstRef.current?.focus({ preventScroll: true }), []);

  return (
    <main className="screen archive">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Archive</span>
      </ScreenHead>

      <section data-glass className="panel prompt">
        <h1>Past dailies</h1>
        <p className="caption">every daily so far. one try each. late plays don't add to your days in a row.</p>
      </section>

      <ol data-glass className="panel arch-list">
        {list.map((e, i) => {
          const r = result(dailyGame(saved, e));
          const isToday = e.date === today;
          const date = formatAsOf(e.date).replace(/, \d{4}$/, "");
          // That date's Blitz: the round played if there is one (the pick for an old date can move as the schedule and
          // the lists grow), else the date's pick, as #dailyblitz-<date> opens it.
          const played = saved.blitzDaily?.[e.date];
          const blitzId = played?.id ?? blitzOfTheDay(schedule, index, e.date);
          const b = blitzResult(played);
          // Both rows name the number and date; CSS shows them once per pair (see .arch-day.pair).
          return (
            <li key={e.date} className={`arch-day ${blitzId ? "pair" : ""} ${isToday ? "today" : ""}`}>
              <a
                ref={i === 0 ? firstRef : undefined}
                className="arch-row"
                data-testid="archive-row"
                data-date={e.date}
                href={`#daily-${e.date}`}
              >
                <span className="arch-n">#{e.n}</span>
                <span className="arch-date">{date}</span>
                <span className="arch-title">
                  <ModeTag mode="classic" />
                  <span className="arch-name">
                    {title(e.id)}
                    {isToday && <span className="arch-tag">today</span>}
                  </span>
                </span>
                <span className={`arch-result ${r.tone}`}>{r.text}</span>
              </a>
              {blitzId && (
                <a
                  className="arch-row arch-blitz-row"
                  data-testid="archive-blitz-row"
                  data-date={e.date}
                  data-list={blitzId}
                  data-score={played?.score}
                  href={`#dailyblitz-${e.date}`}
                >
                  <span className="arch-n">#{e.n}</span>
                  <span className="arch-date">{date}</span>
                  <span className="arch-title">
                    <ModeTag mode="blitz" />
                    <span className="arch-name">{title(blitzId)}</span>
                  </span>
                  <span className={`arch-result ${b.tone}`}>{b.text}</span>
                </a>
              )}
            </li>
          );
        })}
        {list.length === 0 && <li className="arch-empty caption">no dailies yet.</li>}
      </ol>
    </main>
  );
}
