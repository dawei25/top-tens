import { useEffect, useRef, useState } from "react";
import type { PuzzleMeta } from "../game/puzzles";
import { dailyPuzzleId } from "../game/puzzles";
import { load, stats } from "../game/storage";
import { HowToPlay, markHelpSeen } from "./HowToPlay";

interface Props {
  index: PuzzleMeta[];
  day: number;
  onDaily: () => void;
  onRoll: (category?: string) => void;
}

export function Home({ index, day, onDaily, onRoll }: Props) {
  const saved = load();
  const s = stats(saved);
  const [help, setHelp] = useState(!saved.seenHelp);
  const [helpAsked, setHelpAsked] = useState(false);
  const dailyRef = useRef<HTMLButtonElement>(null);
  // Keyboard-first: Enter starts today's list. Focus without scrolling so the title stays in view.
  const focusDaily = () => dailyRef.current?.focus({ preventScroll: true });
  useEffect(() => {
    focusDaily();
  }, []);
  const categories = [...new Set(index.map((p) => p.category))];
  const dailyGame = saved.games[dailyPuzzleId(index, day)];
  const dailyDone = dailyGame && dailyGame.status !== "playing";

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
        <button ref={dailyRef} className="key key-pink key-big" onClick={start(onDaily)}>
          <span className="key-label">Today's list</span>
          <span className="key-sub">{dailyDone ? `done ${dailyGame.found.length}/10` : `no. ${day + 1}`}</span>
        </button>
        <p className="press-enter caption" aria-hidden="true">
          press enter
        </p>
        <button className="key key-big" onClick={start(() => onRoll())}>
          <span className="key-label">Roll a random list</span>
          <span className="key-sub">{index.length} lists</span>
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

      {s.played > 0 && (
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
        <span className="caption">data from wikipedia</span>
      </footer>
    </main>
  );
}
