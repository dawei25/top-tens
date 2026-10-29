import type { DailyEntry } from "../game/daily";
import { recentPlays, type Play } from "../game/history";
import type { PuzzleMeta } from "../game/puzzles";
import { load } from "../game/storage";
import { runTime } from "./Blitz";
import { ScreenHead, ModeTag } from "./pixel";

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

/** Where a row leads: the list (or its daily), or a Blitz run's own results. */
function href(p: Play, schedule: DailyEntry[]): string {
  if (p.kind === "blitz") return `#blitz-${p.id}/run-${p.run.startedAt}`;
  const day = p.run.daily ? schedule.find((e) => e.n === p.run.daily && e.id === p.id) : undefined;
  return day ? `#daily-${day.date}` : `#p-${p.id}`;
}

/** Everything played, list games and Blitz rounds alike, newest first. */
export function History({ index, schedule, entry, onBack, onHome }: Props) {
  const plays = recentPlays(load(), 100);

  return (
    <main className="screen archive">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Past runs</span>
      </ScreenHead>

      <section className="panel prompt">
        <h1>Past runs</h1>
        <p className="caption">everything you've finished, newest first.</p>
      </section>

      {plays.length ? (
        <ol className="panel arch-list">
          {plays.map((p) => {
            const r = result(p);
            const [date, time] = runTime(p.at).split(", ");
            return (
              <li key={`${p.kind}-${p.id}-${p.at}`}>
                <a className="arch-row play-row" href={href(p, schedule)}>
                  <span className="arch-n play-date">{date}</span>
                  <span className="arch-date">{time}</span>
                  <span className="arch-title">
                    {index.find((m) => m.id === p.id)?.title ?? p.id}
                    <span className="play-tags">
                      <ModeTag mode={p.kind === "blitz" ? "blitz" : "classic"} />
                      {p.kind === "list" && p.run.daily && <span className="play-tag">daily #{p.run.daily}</span>}
                      {p.kind === "blitz" && p.today && <span className="play-tag blitz">today's blitz</span>}
                    </span>
                  </span>
                  <span className={`arch-result ${r.tone}`}>{r.text}</span>
                </a>
              </li>
            );
          })}
        </ol>
      ) : (
        <section className="panel error">
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
