import { useEffect, useRef } from "react";
import { archive, blitzOfTheDay, dailyGame, type DailyEntry } from "../game/daily";
import type { PuzzleMeta } from "../game/puzzles";
import { load, type DailyBlitzResult } from "../game/storage";
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

function blitzResult(r?: DailyBlitzResult): { text: string; tone: string } {
  return r ? { text: `${r.score} pts`, tone: "gold" } : { text: "not played", tone: "faint" };
}

/**
 * Every daily so far, newest first, as a table: one row per day, its number and date, then that day's list and that
 * day's Blitz (another list) side by side, the two columns named once in the header. Each cell opens its own one-try
 * game; old ones played late don't count toward streaks.
 */
export function Archive({ index, schedule, today, onBack, onHome }: Props) {
  const saved = load();
  const list = archive(schedule, today);
  const title = (id: string) => index.find((p) => p.id === id)?.title ?? id;
  const firstRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => firstRef.current?.focus({ preventScroll: true }), []);

  return (
    <main className="screen archive past-dailies">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Archive</span>
      </ScreenHead>

      <section data-glass className="panel prompt">
        <h1>Past dailies</h1>
        <p className="caption">every daily so far. one try each. late plays don't add to your days in a row.</p>
      </section>

      <section data-glass className="panel arch-table" data-testid="archive-table">
        {/* The column names, once. Screen readers get the mode in each cell instead. */}
        <div className="arch-head" aria-hidden="true">
          <span className="arch-col list" data-testid="archive-col-list">
            List
          </span>
          <span className="arch-col blitz" data-testid="archive-col-blitz">
            Blitz
          </span>
        </div>
        <ol className="arch-days">
          {list.map((e, i) => {
            const r = result(dailyGame(saved, e));
            const isToday = e.date === today;
            const date = formatAsOf(e.date).replace(/, \d{4}$/, "");
            // That date's Blitz: the round played if there is one (the pick for an old date can move as the schedule
            // and the lists grow), else the date's pick, as #dailyblitz-<date> opens it.
            const played = saved.blitzDaily?.[e.date];
            const blitzId = played?.id ?? blitzOfTheDay(schedule, index, e.date);
            const b = blitzResult(played);
            // Each cell names its day and mode for screen readers; the day column and the header are for the eye.
            const day = `#${e.n} ${date}${isToday ? ", today" : ""}`;
            return (
              <li key={e.date} className={`arch-day${isToday ? " today" : ""}`} data-testid="archive-day" data-date={e.date}>
                <div className="arch-when" aria-hidden="true">
                  <span className="arch-n">#{e.n}</span>
                  <span className="arch-date">{date}</span>
                  {isToday && <span className="arch-tag">today</span>}
                </div>
                <a
                  ref={i === 0 ? firstRef : undefined}
                  className="arch-cell list"
                  data-testid="archive-row"
                  data-date={e.date}
                  href={`#daily-${e.date}`}
                >
                  <span className="sr-only">{day}, List: </span>
                  <span className="arch-name">{title(e.id)}</span>{" "}
                  <span className={`arch-status ${r.tone}`}>{r.text}</span>
                </a>
                {blitzId ? (
                  <a
                    className="arch-cell blitz"
                    data-testid="archive-blitz-row"
                    data-date={e.date}
                    data-list={blitzId}
                    data-score={played?.score}
                    href={`#dailyblitz-${e.date}`}
                  >
                    <span className="sr-only">{day}, Blitz: </span>
                    <span className="arch-name">{title(blitzId)}</span>{" "}
                    <span className={`arch-status ${b.tone}`}>{b.text}</span>
                  </a>
                ) : (
                  <span className="arch-cell blitz none" data-testid="archive-blitz-none" data-date={e.date}>
                    <span aria-hidden="true">{"–"}</span>
                    <span className="sr-only">{day}: no Blitz</span>
                  </span>
                )}
              </li>
            );
          })}
          {list.length === 0 && <li className="arch-empty caption">no dailies yet.</li>}
        </ol>
      </section>
    </main>
  );
}
