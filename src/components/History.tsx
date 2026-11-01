import { isDailyBlitzRun } from "../game/blitz";
import { entryForDate, todayEntry, type DailyEntry } from "../game/daily";
import { recentPlays, type Play } from "../game/history";
import type { PuzzleMeta } from "../game/puzzles";
import { load, type Saved } from "../game/storage";
import { runTime } from "./Blitz";
import { ScreenHead, ModeTag } from "./pixel";
import { usePar, vsParText } from "./par";

interface Props {
  index: PuzzleMeta[];
  schedule: DailyEntry[];
  /** Today's daily, for the empty state's key. */
  entry?: DailyEntry;
  onBack: () => void;
  onHome: () => void;
}

function result(p: Play): { text: string; tone: string } {
  if (p.kind === "blitz") {
    const k = p.run.hits.length;
    return { text: `${p.run.score} pts · ${k} answer${k === 1 ? "" : "s"}`, tone: "gold" };
  }
  const r = p.run;
  const n = r.found.length;
  if (r.status === "gave-up") return { text: `gave up ${n}/10`, tone: "muted" };
  if (r.status === "lost") return { text: `${n}/10 · out of lives`, tone: "text" };
  return { text: `10/10 · ${r.lives} ${r.lives === 1 ? "life" : "lives"}`, tone: "gold" };
}

/** The date whose Blitz a round was (Today's Blitz, on the day or later from a link), if it was one. */
function blitzDate(p: Play, saved: Saved): string | undefined {
  if (p.kind !== "blitz") return undefined;
  return Object.entries(saved.blitzDaily ?? {}).find(([, d]) => isDailyBlitzRun(d, p.id, p.run))?.[0];
}

/**
 * Where a row leads: the list (or its daily), or a Blitz run's own results; a date's Blitz round opens on that date's
 * Blitz screen, which keeps it from spoiling that date's list.
 */
function href(p: Play, schedule: DailyEntry[], date?: string): string {
  if (p.kind === "blitz") return date ? `#dailyblitz-${date}/run-${p.run.startedAt}` : `#blitz-${p.id}/run-${p.run.startedAt}`;
  const day = p.run.daily ? schedule.find((e) => e.n === p.run.daily && e.id === p.id) : undefined;
  return day ? `#daily-${day.date}` : `#p-${p.id}`;
}

/** Everything played, list games and Blitz rounds alike, newest first. */
export function History({ index, schedule, entry, onBack, onHome }: Props) {
  const saved = load();
  const plays = recentPlays(saved, 100);
  const par = usePar();

  return (
    <main className="screen archive">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Past runs</span>
      </ScreenHead>

      <section data-glass className="panel prompt">
        <h1>Past runs</h1>
        <p className="caption">everything you've finished, newest first.</p>
      </section>

      {plays.length ? (
        <ol data-glass className="panel arch-list">
          {plays.map((p) => {
            const r = result(p);
            const [date, time] = runTime(p.at).split(", ");
            const day = blitzDate(p, saved);
            const dayN = day && (entryForDate(schedule, day) ?? todayEntry(schedule, day))?.n;
            return (
              <li key={`${p.kind}-${p.id}-${p.at}`}>
                <a className="arch-row play-row" data-testid="history-row" data-kind={p.kind} href={href(p, schedule, day)}>
                  <span className="arch-n play-date">{date}</span>
                  <span className="arch-date">{time}</span>
                  <span className="arch-title">
                    {index.find((m) => m.id === p.id)?.title ?? p.id}
                    <span className="play-tags">
                      <ModeTag mode={p.kind === "blitz" ? "blitz" : "classic"} />
                      {p.kind === "list" && p.run.daily && <span className="play-tag">daily #{p.run.daily}</span>}
                      {/* A date's Blitz round, numbered like the dailies; the row's title is the list it ran on. */}
                      {day && <span className="play-tag blitz">{dayN ? `blitz #${dayN}` : "today's blitz"}</span>}
                    </span>
                  </span>
                  <span className={`arch-result ${r.tone}`}>
                    {r.text}
                    {p.kind === "list" && par?.[p.id] && (
                      <span className="vs-par" data-testid="history-vs-par">
                        {vsParText(p.run.found.length - par[p.id].par)}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
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
