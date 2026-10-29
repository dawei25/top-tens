import type { PuzzleMeta } from "../game/puzzles";
import { load } from "../game/storage";
import { runTime } from "./Blitz";
import { BackArrow } from "./pixel";

/** Every list with finished Blitz rounds: best, how many, when last played. Each row opens that list's runs. */
export function BlitzRuns({ index, onHome }: { index: PuzzleMeta[]; onHome: () => void }) {
  const saved = load();
  const lists = Object.entries(saved.blitzRuns ?? {})
    .filter(([, runs]) => runs.length > 0)
    .map(([id, runs]) => ({
      id,
      title: index.find((p) => p.id === id)?.title ?? id,
      best: saved.blitzBest?.[id] ?? Math.max(...runs.map((r) => r.score)),
      count: runs.length,
      last: Math.max(...runs.map((r) => r.startedAt)),
    }))
    .sort((a, b) => b.last - a.last);

  return (
    <main className="screen archive">
      <header className="game-head">
        <button className="key key-icon" onClick={onHome} aria-label="Home">
          <BackArrow />
        </button>
        <div className="game-head-mid">
          <span className="label mode gold">Blitz runs</span>
        </div>
        <span className="key-sm-spacer" aria-hidden="true" />
      </header>

      <section className="panel prompt">
        <h1>Blitz runs</h1>
        <p className="caption">every list you've played in blitz. the last 20 rounds on each are kept.</p>
      </section>

      <ol className="panel arch-list">
        {lists.map((l) => (
          <li key={l.id}>
            <a className="arch-row runs-row" href={`#blitz-${l.id}/runs`}>
              <span className="arch-n gold">{l.best}</span>
              <span className="arch-date">best</span>
              <span className="arch-title">{l.title}</span>
              <span className="arch-result muted">
                {l.count} run{l.count === 1 ? "" : "s"}
                <small>{runTime(l.last)}</small>
              </span>
            </a>
          </li>
        ))}
        {lists.length === 0 && <li className="arch-empty caption">no blitz rounds yet.</li>}
      </ol>
    </main>
  );
}
