import { useEffect, useRef, useState } from "react";
import type { PuzzleMeta } from "../game/puzzles";
import { streak, type DailyEntry } from "../game/daily";
import { load, save, stats } from "../game/storage";
import { recentPlays } from "../game/history";
import { Countdown } from "./Countdown";
import { HowToPlay, markHelpSeen } from "./HowToPlay";
import { EnterHint, ModeTag, type Mode } from "./pixel";

/**
 * A home key: mode tag and status on top, the action below. Today's keys carry their mode's accent while unplayed
 * (filled when focused) and settle once played; free-play keys stay quiet.
 */
function ModeKey({
  mode,
  title,
  status,
  today = false,
  done = false,
  disabled = false,
  btnRef,
  onClick,
}: {
  mode: Mode;
  title: string;
  status: string;
  today?: boolean;
  done?: boolean;
  disabled?: boolean;
  btnRef?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
}) {
  return (
    <button
      ref={btnRef}
      className={`key mode-key ${mode} ${today ? "today" : ""} ${done ? "done" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="mode-key-top">
        <ModeTag mode={mode} />
        <span className="key-sub">{status}</span>
      </span>
      <span className="mode-key-main">
        <span className="key-label">{title}</span>
        <EnterHint />
      </span>
    </button>
  );
}

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
  const blitzRef = useRef<HTMLButtonElement>(null);
  const dailyGame = entry && saved.games[entry.id];
  const dailyDone = !!dailyGame && dailyGame.status !== "playing";
  const dailyBlitzDone = saved.blitzDaily?.[today];
  // Keyboard-first: Enter starts today's list, or today's Blitz once the list is done. Focus without scrolling so
  // the title stays in view. The focused today key is the one loud element on the screen.
  // Touch screens have no Enter to press, so they get no auto focus (and no focus ring on a key nobody chose).
  const focusDaily = () => {
    if (typeof matchMedia === "function" && !matchMedia("(pointer: fine)").matches) return;
    (dailyDone && hasDailyBlitz && !dailyBlitzDone ? blitzRef : dailyRef).current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    // Only on arrival.
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
  const plays = recentPlays(saved, 1000).length;
  const hasProgress =
    plays > 0 ||
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
  const blitzCount = index.filter((p) => p.blitz).length;

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

      <section className="home-group" aria-labelledby="today-title">
        <div className="group-head">
          <h2 id="today-title" className="label">
            Today{entry ? ` · no. ${entry.n}` : ""}
          </h2>
          <Countdown label="new lists in" />
        </div>
        <div className="today-stack">
          <ModeKey
            mode="classic"
            today
            btnRef={dailyRef}
            title="Today's list"
            status={!entry ? "none yet" : dailyDone ? `${dailyGame.found.length}/10` : dailyGame ? "playing" : "new"}
            done={dailyDone}
            disabled={!entry}
            onClick={start(onDaily)}
          />
          {hasDailyBlitz && (
            <ModeKey
              mode="blitz"
              today
              btnRef={blitzRef}
              title="Today's Blitz"
              status={dailyBlitzDone ? `${dailyBlitzDone.score} pts` : "new"}
              done={!!dailyBlitzDone}
              onClick={start(onDailyBlitz)}
            />
          )}
        </div>
      </section>

      <section className="home-group" aria-labelledby="free-title">
        <div className="group-head">
          <h2 id="free-title" className="label">
            Free play
          </h2>
        </div>
        <div className="mode-pair">
          <ModeKey mode="classic" title="Random list" status={`${index.length} lists`} onClick={start(() => onRoll())} />
          <ModeKey
            mode="blitz"
            title="Random Blitz"
            status={`${blitzCount} lists`}
            onClick={start(() => {
              setNoBlitz(false);
              onBlitz().then((ok) => setNoBlitz(!ok));
            })}
          />
        </div>
        {noBlitz && <p className="caption blitz-none">no lists are open for blitz yet.</p>}
        {/* A chip rolls a random classic list in that category, straight away. */}
        <div className="cat-row">
          <span className="caption">or by category</span>
          <div className="chips">
            {categories.map((c) => (
              <button key={c} className="chip" onClick={start(() => onRoll(c))}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="home-group" aria-labelledby="games-title">
        <h2 id="games-title" className="label">
          Your games
        </h2>
        <div className="games-row">
          <button className="key key-sm games-key" onClick={start(onArchive)}>
            Archive <span className="games-n">{archiveCount}</span>
          </button>
          <button className="key key-sm games-key" onClick={start(() => (location.hash = "#history"))}>
            Past runs {plays > 0 && <span className="games-n">{plays}</span>}
          </button>
        </div>
      </section>

      {(s.played > 0 || st.best > 0) && (
        <section className="panel home-stats" aria-labelledby="stats-title">
          <h2 id="stats-title" className="label">
            Your record
          </h2>
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
