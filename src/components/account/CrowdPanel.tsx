import { compareWithPlayers, formatCount, MIN_PLAYERS } from "../../net/crowd";
import { useListAverages } from "../../net";
import type { PuzzleMeta } from "../../game/puzzles";
import { firstListRuns } from "../../game/history";
import { load } from "../../game/storage";
import { signed } from "../par";
import "./account.css";

/**
 * The knowledge page next to real players: for each list you've finished that at least MIN_PLAYERS players have
 * finished too, your first try against their average (one score per player: their first game, as your stats count
 * yours). Nothing until there's one.
 */
export default function CrowdPanel({ index }: { index: PuzzleMeta[] }) {
  const averages = useListAverages();
  if (!averages) return null;
  const rows = compareWithPlayers(firstListRuns(load()), averages);
  if (!rows.length) return null;

  const games = rows.reduce((a, r) => a + r.games, 0);
  const you = rows.reduce((a, r) => a + r.you * r.games, 0) / games;
  const players = rows.reduce((a, r) => a + r.players * r.games, 0) / games;
  const scale = Math.max(3, ...rows.map((r) => Math.abs(r.you - r.players)));
  const title = (id: string) => index.find((m) => m.id === id)?.title ?? id;

  return (
    <section data-glass className="panel know-list crowd" aria-labelledby="know-players" data-testid="crowd-panel">
      <div className="know-head">
        <h2 id="know-players" className="label cyan">
          Vs players
        </h2>
        <span className="know-axis" aria-hidden="true">
          <span>below</span>
          <span>avg</span>
          <span>above</span>
        </span>
      </div>
      <p className="caption crowd-caption" data-testid="crowd-summary">
        on lists {MIN_PLAYERS}+ players have finished: you average {you.toFixed(1)}, they average {players.toFixed(1)}.
      </p>
      <ol>
        {rows.map((r) => {
          const diff = r.you - r.players;
          const steps = Math.round((Math.abs(diff) / scale) * 12);
          const w = `${((Number(diff.toFixed(1)) === 0 ? 0 : Math.max(1, steps)) * 50) / 12}%`;
          const tone = diff > 0.05 ? "over" : diff < -0.05 ? "under" : "";
          return (
            <li key={r.id} className="know-row" data-testid="crowd-row" data-id={r.id} data-diff={diff.toFixed(1)}>
              <span className="know-name">
                {title(r.id)}
                <span className="know-sub">
                  you {r.you} · players avg {r.players.toFixed(1)} ({formatCount(r.n)})
                </span>
              </span>
              <span className="know-bar" aria-hidden="true">
                <span className={`know-fill ${diff >= 0 ? "over" : "under"}`} style={{ width: w }} />
              </span>
              <span className={`know-vs ${tone}`}>{signed(diff, 1)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
