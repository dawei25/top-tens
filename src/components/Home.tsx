import { useEffect, useRef, useState } from "react";
import type { PuzzleMeta } from "../game/puzzles";
import { streak, type DailyEntry } from "../game/daily";
import { load, save, stats } from "../game/storage";
import { Countdown } from "./Countdown";
import { HowToPlay, markHelpSeen } from "./HowToPlay";

interface Props {
  index: PuzzleMeta[];
  /** Today's daily; missing only if the schedule failed to load. */
  entry?: DailyEntry;
  archiveCount: number;
  onDaily: () => void;
  onRoll: (category?: string) => void;
  /** Goes to a random Blitz-ready list; false when there is none. */
  onBlitz: () => Promise<boolean>;
  onArchive: () => void;
  /** The player's local date. */
  today: string;
  /** Whether today has a Blitz list. */
  hasDailyBlitz: boolean;
  onDailyBlitz: () => void;
}

export function Home({
  index,
  entry,
  archiveCount,
  onDaily,
  onRoll,
  onBlitz,
  onArchive,
  today,
  hasDailyBlitz,
  onDailyBlitz,
}: Props) {
  const [noBlitz, setNoBlitz] = useState(false);
  const saved = load();
  const s = stats(saved);
  const st = streak(saved);
  const [help, setHelp] = useState(!saved.seenHelp);
  const [helpAsked, setHelpAsked] = useState(false);
  const dailyRef = useRef<HTMLButtonElement>(null);
  // Keyboard-first: Enter starts today's list. Focus without scrolling so the title stays in view.
  const focusDaily = () => dailyRef.current?.focus({ preventScroll: true });
  useEffect(() => {
    focusDaily();
  }, []);
  // Inline confirm, like GIVE UP: the first click arms it for 3 s, the second clears everything but seenHelp.
  const [confirmReset, setConfirmReset] = useState(false);
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(t);
  }, [confirmReset]);
  const blitzRuns = Object.values(saved.blitzRuns ?? {}).reduce((k, runs) => k + runs.length, 0);
  const hasProgress =
    Object.keys(saved.games).length > 0 ||
    Object.keys(saved.daily).length > 0 ||
    blitzRuns > 0 ||
    Object.keys(saved.blitzDaily ?? {}).length > 0 ||
    Object.keys(saved.blitzLive ?? {}).length > 0;
  const resetAll = () => {
    if (!confirmReset) return setConfirmReset(true);
    setConfirmReset(false);
    save({ games: {}, daily: {}, seenHelp: load().seenHelp });
    setVersion((v) => v + 1);
    focusDaily();
  };
  const categories = [...new Set(index.map((p) => p.category))];
  const dailyGame = entry && saved.games[entry.id];
  const dailyDone = !!dailyGame && dailyGame.status !== "playing";
  const dailyBlitzDone = saved.blitzDaily?.[today];

  // Starting a game with the rules on screen counts as having seen them.
  const start = (fn: () => void) => () => {
    if (help) markHelpSeen();
    fn();
  };

  return (
    <main className="screen home">
      <header className="title">
        <p className="label title-kicker">High score table</p>
        <h1 className="logo" aria-label="Top Tens">
          <span>Top</span> <span>Tens</span>
        </h1>
        <p className="caption">name the top 10. five lives. typos are free.</p>
      </header>

      {help && (
        <HowToPlay
          scroll={helpAsked}
          onClose={() => {
            setHelp(false);
            focusDaily();
          }}
        />
      )}

      <section className="home-actions">
        <button ref={dailyRef} className="key key-pink key-big" onClick={start(onDaily)} disabled={!entry}>
          <span className="key-label">Today's list</span>
          <span className="key-sub">
            {entry ? `no. ${entry.n}` : "none yet"}
            {dailyDone && ` · ${dailyGame.found.length}/10`}
          </span>
        </button>
        {hasDailyBlitz && (
          <button className="key key-big key-blitz" onClick={start(onDailyBlitz)}>
            <span className="key-label">Today's Blitz</span>
            <span className="key-sub">
              {dailyBlitzDone ? `${dailyBlitzDone.score} pts` : `${entry ? `no. ${entry.n} · ` : ""}90 s`}
            </span>
          </button>
        )}
        <div className="daily-meta">
          <Countdown className="caption" />
          <p className="press-enter caption" aria-hidden="true">
            press enter
          </p>
        </div>
        <button className="key key-big" onClick={start(() => onRoll())}>
          <span className="key-label">Roll a random list</span>
          <span className="key-sub">{index.length} lists</span>
        </button>
        <button
          className="key key-big key-blitz"
          onClick={start(() => {
            setNoBlitz(false);
            onBlitz().then((ok) => setNoBlitz(!ok));
          })}
        >
          <span className="key-label">Blitz a random list</span>
          <span className="key-sub">90 s</span>
        </button>
        {noBlitz && <p className="caption blitz-none">no lists are open for blitz yet.</p>}
        <button className="key key-big" onClick={start(onArchive)}>
          <span className="key-label">Archive</span>
          <span className="key-sub">{archiveCount} dailies</span>
        </button>
      </section>

      <section className="home-cats" aria-labelledby="cats-title">
        <h2 id="cats-title" className="label">
          Roll by category
        </h2>
        <div className="chips">
          {categories.map((c) => (
            <button key={c} className="chip" onClick={start(() => onRoll(c))}>
              {c}
            </button>
          ))}
        </div>
      </section>

      {(s.played > 0 || st.best > 0 || blitzRuns > 0) && (
        <section className="panel home-stats" aria-labelledby="stats-title">
          <div className="panel-head">
            <h2 id="stats-title" className="label">
              Your record
            </h2>
            {blitzRuns > 0 && (
              <a className="text-btn" href="#blitz-history">
                blitz runs ({blitzRuns})
              </a>
            )}
          </div>
          <dl className="stat-row">
            <div>
              <dt>played</dt>
              <dd>{s.played}</dd>
            </div>
            <div>
              <dt>avg / 10</dt>
              <dd>{s.avgFound.toFixed(1)}</dd>
            </div>
            <div>
              <dt>perfect</dt>
              <dd className="gold">{s.perfect}</dd>
            </div>
            <div>
              <dt>streak</dt>
              <dd className="pink">{st.current}</dd>
            </div>
            <div>
              <dt>best streak</dt>
              <dd>{st.best}</dd>
            </div>
          </dl>
        </section>
      )}

      <footer className="home-foot">
        {!help && (
          <button
            className="key key-sm"
            onClick={() => {
              setHelpAsked(true);
              setHelp(true);
            }}
          >
            How to play
          </button>
        )}
        <span className="home-foot-end">
          <span className="caption">data from wikipedia</span>
          {hasProgress && (
            <button
              type="button"
              className={`text-btn ${confirmReset ? "danger" : ""}`}
              onClick={resetAll}
              onBlur={() => setConfirmReset(false)}
            >
              {confirmReset ? "sure?" : "reset all progress"}
            </button>
          )}
        </span>
      </footer>
    </main>
  );
}
