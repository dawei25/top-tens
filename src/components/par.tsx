import { useEffect, useState } from "react";
import { loadPar, percentile, percentileLabel, type ListPar, type ParFile } from "../game/par";
import { useListStats } from "../net";
import { formatCount, pickCounts } from "../net/crowd";

// Players see this figure as the players' average ("avg"), and only once a game is over: the results, Past runs and
// Stats. The code keeps the data's name for it, par (par.json).

/** par.json, once loaded (null until then; an empty map if it's missing). */
export function usePar(): ParFile | null {
  const [par, setPar] = useState<ParFile | null>(null);
  useEffect(() => {
    let live = true;
    loadPar().then((p) => live && setPar(p));
    return () => {
      live = false;
    };
  }, []);
  return par;
}

/** "+2", "-0.5", "0": a score's distance from the average, one decimal for averages. */
export function signed(n: number, decimals = 0): string {
  const v = Number(n.toFixed(decimals));
  return v > 0 ? `+${v.toFixed(decimals)}` : v < 0 ? `-${Math.abs(v).toFixed(decimals)}` : (0).toFixed(decimals);
}

/** "+2 vs avg", "-1 vs avg", "same as avg". */
export function vsParText(diff: number, decimals = 0): string {
  return Number(diff.toFixed(decimals)) === 0 ? "same as avg" : `${signed(diff, decimals)} vs avg`;
}

/** Bar heights snap to this many px, so the histogram stays on the pixel grid. */
const STEP = 3;
const MAX_H = 42;

/** 11 bars for scores 0 to 10: the player's bar lit, a caret under the average. */
export function ParHistogram({ counts, par, score }: { counts: number[]; par: number; score: number }) {
  const max = Math.max(1, ...counts);
  return (
    <div
      className="histogram"
      data-testid="histogram"
      role="img"
      aria-label={`How players score on this list, 0 to 10: they average ${par}, you got ${score}.`}
    >
      <div className="histo-bars">
        {counts.map((c, i) => {
          // Your bar always shows at least one step, so the highlight is never missing.
          const h = c || i === score ? Math.max(STEP, Math.round(((c / max) * MAX_H) / STEP) * STEP) : 0;
          return (
            <span
              key={i}
              className="histo-col"
              data-score={i}
              data-you={i === score || undefined}
              data-par={i === Math.round(par) || undefined}
            >
              <span className="histo-bar" style={{ height: h }} />
            </span>
          );
        })}
      </div>
      <div className="histo-axis" aria-hidden="true">
        <span>0</span>
        <span>10</span>
      </div>
    </div>
  );
}

/**
 * The results panel's average block: what players average on the list, the histogram, and where the score stands.
 * It reads at a glance, with nothing to hover: "PLAYERS AVG 6", "top 45% of players", and "(estimated)" in plain
 * words while the numbers come from simulated players rather than real ones. With a backend (and the list's id), real
 * players replace the estimate once enough of them have finished the list: their average, their spread, and "better
 * than 12% of 1,203 players".
 */
export function ParBlock({ list, score, id }: { list: ListPar; score: number; id?: string }) {
  const { counts, real } = pickCounts(list.counts, useListStats(id, "list"));
  const p = percentile(counts, score);
  const avg = real && real.avg !== null ? Math.round(real.avg * 10) / 10 : list.par;
  return (
    <div className="par-block" data-testid="par" data-par={avg} data-source={real ? "players" : "estimate"} data-n={real?.n}>
      <div className="par-row">
        <p className="par-stat">
          <span className="label">Players avg</span>
          <b>{avg}</b>
        </p>
        <ParHistogram counts={counts} par={avg} score={score} />
      </div>
      <p className="par-line">
        {/* One text node, as before real players: split nodes shape the pixel font a little differently. */}
        <span>{`${percentileLabel(p)} of ${real ? formatCount(real.n) + " " : ""}players`}</span>{" "}
        {!real && list.estimated && <span className="par-est">(estimated)</span>}
      </p>
    </div>
  );
}
