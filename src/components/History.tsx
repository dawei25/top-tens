import { localDate, type DailyEntry } from "../game/daily";
import { recentPlays, type Play } from "../game/history";
import type { PuzzleMeta } from "../game/puzzles";
import { load } from "../game/storage";
import { ScreenHead, shortDate } from "./pixel";
import { usePar, vsParText } from "./par";

interface Props {
  index: PuzzleMeta[];
  /** The player's local date, for the day headers (Today, Yesterday). */
  today: string;
  /** Today's daily, for the empty state's key. */
  entry?: DailyEntry;
  onBack: () => void;
  onHome: () => void;
}

/** A space that never breaks: on the narrowest phones a result wraps only at its dot ("283 pts ·" / "3 answers"). */
const NB = String.fromCharCode(160);

/** The score first, then how it ended. */
function result(p: Play): { text: string; tone: string } {
  if (p.kind === "blitz") {
    const k = p.run.hits.length;
    return { text: `${p.run.score}${NB}pts · ${k}${NB}answer${k === 1 ? "" : "s"}`, tone: "gold" };
  }
  const r = p.run;
  const n = r.found.length;
  if (r.status === "gave-up") return { text: `${n}/10 · gave${NB}up`, tone: "muted" };
  if (r.status === "lost") return { text: `${n}/10 · out${NB}of${NB}lives`, tone: "text" };
  return { text: `10/10 · ${r.lives}${NB}${r.lives === 1 ? "life" : "lives"}${NB}left`, tone: "gold" };
}

/**
 * Where a row leads: always its own run. A list game opens its run view, a Blitz round its run's results (on its
 * list's Blitz screen, which stays closed while that would spoil a daily). Rounds from the days of Today's Blitz
 * (before Nov 10) open the same way.
 */
function href(p: Play): string {
  if (p.kind === "blitz") return `#blitz-${p.id}/run-${p.run.startedAt}`;
  return `#p-${p.id}/run-${p.run.startedAt}`;
}

/**
 * The row's one tag: the mode, and the day's number when it was that day's list ("List #22", as the archive numbers
 * the day). Blitz is free play only, so a Blitz round is "Blitz", the old Today's Blitz rounds too. One line on any
 * phone.
 */
function tag(p: Play): string {
  if (p.kind === "list") return p.run.daily ? `List #${p.run.daily}` : "List";
  return "Blitz";
}

/** "21:40" in the player's time. */
function clock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The day header: Today, Yesterday, then "Nov 1". */
function dayName(date: string, today: string): string {
  if (date === today) return "Today";
  const [y, m, d] = today.split("-").map(Number);
  if (date === localDate(new Date(y, m - 1, d - 1))) return "Yesterday";
  return shortDate(date, today);
}

/** Everything played, list games and Blitz rounds alike, newest first, under one header per day. */
export function History({ index, today, entry, onBack, onHome }: Props) {
  const saved = load();
  const plays = recentPlays(saved, 100);
  const par = usePar();
  const days = new Map<string, Play[]>();
  for (const p of plays) {
    const day = localDate(new Date(p.at));
    days.set(day, [...(days.get(day) ?? []), p]);
  }

  return (
    <main className="screen archive past-runs">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Past runs</span>
      </ScreenHead>

      <section data-glass className="panel prompt">
        <h1>Past runs</h1>
        <p className="caption">everything you've finished, newest first.</p>
      </section>

      {plays.length ? (
        <section data-glass className="panel play-list" data-testid="history-list">
          {[...days].map(([day, dayPlays]) => (
            <section key={day} className="play-day" data-testid="history-day" data-date={day} aria-labelledby={`day-${day}`}>
              <h2 id={`day-${day}`} className="play-day-name">
                {dayName(day, today)}
              </h2>
              <ol className="play-rows">
                {dayPlays.map((p) => {
                  const r = result(p);
                  const mode = p.kind === "blitz" ? "blitz" : "classic";
                  return (
                    <li key={`${p.kind}-${p.id}-${p.at}`}>
                      <a className={`play-row ${mode}`} data-testid="history-row" data-kind={p.kind} href={href(p)}>
                        <time className="play-time" dateTime={new Date(p.at).toISOString()}>
                          {clock(p.at)}
                        </time>
                        <span className="play-title">{index.find((m) => m.id === p.id)?.title ?? p.id}</span>
                        <span className="play-tag" data-testid="history-tag">
                          {tag(p)}
                        </span>
                        <span className={`play-result ${r.tone}`}>{r.text}</span>
                        {p.kind === "list" && par?.[p.id] && (
                          <span className="play-vs vs-par" data-testid="history-vs-par">
                            {vsParText(p.run.found.length - par[p.id].par)}
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </section>
      ) : (
        <section data-glass className="panel error">
          <p>nothing played yet.</p>
          {entry && (
            <a className="key key-pink" href={`#daily-${entry.date}`}>
              Today's list
            </a>
          )}
        </section>
      )}
    </main>
  );
}
