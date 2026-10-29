import { useState } from "react";
import type { PuzzleMeta } from "../game/puzzles";
import { dailyPuzzleId } from "../game/puzzles";
import { load, stats } from "../game/storage";
import { HowToPlay } from "./HowToPlay";

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
  const categories = [...new Set(index.map((p) => p.category))];
  const dailyGame = saved.games[dailyPuzzleId(index, day)];
  const dailyDone = dailyGame && dailyGame.status !== "playing";

  return (
    <main className="home">
      <header className="home-head">
        <h1 className="logo">
          Top <span>Tens</span>
        </h1>
        <p className="tagline">Name the top 10. Five lives. Typos are free.</p>
      </header>

      <section className="home-actions">
        <button className="btn btn-primary btn-big" onClick={onDaily}>
          <span className="btn-label">Today's list</span>
          <span className="btn-sub">{dailyDone ? `Done: ${dailyGame.found.length}/10` : `#${day + 1}`}</span>
        </button>
        <button className="btn btn-secondary btn-big" onClick={() => onRoll()}>
          <span className="btn-label">Roll a random list</span>
          <span className="btn-sub">{index.length} lists</span>
        </button>
      </section>

      <section className="chips" aria-label="Roll by category">
        {categories.map((c) => (
          <button key={c} className="chip" onClick={() => onRoll(c)}>
            {c}
          </button>
        ))}
      </section>

      {s.played > 0 && (
        <section className="home-stats">
          <div>
            <b>{s.played}</b>
            <span>played</span>
          </div>
          <div>
            <b>{s.avgFound.toFixed(1)}</b>
            <span>avg / 10</span>
          </div>
          <div>
            <b>{s.perfect}</b>
            <span>perfect</span>
          </div>
        </section>
      )}

      <footer className="home-foot">
        <button className="link" onClick={() => setHelp(true)}>
          How to play
        </button>
        <span>Data from Wikipedia</span>
      </footer>

      {help && <HowToPlay onClose={() => setHelp(false)} />}
    </main>
  );
}
