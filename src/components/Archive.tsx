import { useEffect, useRef } from "react";
import { archive, dailyGame, type DailyEntry } from "../game/daily";
import type { PuzzleMeta } from "../game/puzzles";
import { load } from "../game/storage";
import type { GameState } from "../game/state";
import { ScreenHead, shortDate } from "./pixel";

interface Props {
  index: PuzzleMeta[];
  schedule: DailyEntry[];
  today: string;
  onBack: () => void;
  onHome: () => void;
}

/** A cell's status under its title. Unplayed cells show none: a new player would see "not played" on every row. */
function result(g?: GameState): { text: string; tone: string } | undefined {
  if (!g) return undefined;
  if (g.status === "playing") return { text: `playing ${g.found.length}/10`, tone: "cyan" };
  if (g.status === "gave-up") return { text: `gave up ${g.found.length}/10`, tone: "muted" };
  return { text: `${g.found.length}/10`, tone: g.status === "won" ? "gold" : "text" };
}

/** The status line, or (unplayed) a word for screen readers only. */
function Status({ r }: { r?: { text: string; tone: string } }) {
  return r ? (
    <span className={`arch-status ${r.tone}`} data-testid="archive-status">
      {r.text}
    </span>
  ) : (
    <span className="sr-only">not played</span>
  );
}

/**
 * Every daily so far, newest first, as a table: one row per day, its number and date, then that day's list. Each row
 * opens its own one-try game; old ones played late don't count toward days in a row. (Blitz is free play only: past
 * Blitz rounds are in Past runs.)
 */
export function Archive({ index, schedule, today, onBack, onHome }: Props) {
  const saved = load();
  const list = archive(schedule, today);
  const title = (id: string) => index.find((p) => p.id === id)?.title ?? id;
  const firstRef = useRef<HTMLAnchorElement>(null);
  // Keyboard-first: Enter opens the newest list. Touch screens have no Enter, so no focus ring on a cell nobody chose.
  useEffect(() => {
    if (typeof matchMedia === "function" && !matchMedia("(pointer: fine)").matches) return;
    firstRef.current?.focus({ preventScroll: true });
  }, []);

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
        <ol className="arch-days">
          {list.map((e, i) => {
            const r = result(dailyGame(saved, e));
            const isToday = e.date === today;
            const date = shortDate(e.date, today);
            // The cell names its day for screen readers; the day column is for the eye.
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
                  <span className="sr-only">{day}: </span>
                  <span className="arch-name">
                    {title(e.id)}
                    <span className="sr-only">,</span>
                  </span>
                  <Status r={r} />
                </a>
              </li>
            );
          })}
          {list.length === 0 && <li className="arch-empty caption">no dailies yet.</li>}
        </ol>
      </section>
    </main>
  );
}
