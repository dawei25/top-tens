import { useEffect, useState } from "react";
import { loadPar, type ListPar, type ParFile } from "../game/par";
import { useListStats } from "../net";
import { blendAverage, blendCounts, standing } from "../net/crowd";
import { playersLine } from "./copy";
import { CrowdCurve } from "./CrowdCurve";

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

/**
 * The results panel's average block: what players average on the list, their curve, and where the score stands.
 * It reads at a glance, with nothing to hover: "PLAYERS AVG 6", "better than 36% of players", and "today" on a daily
 * on its own day (`today`). With a backend (and the list's id), real players join the estimate as they finish the
 * list (net/crowd's blend: the estimate counts as ESTIMATE_WEIGHT players). Never "(estimated)" (owner, Nov 14: "dont
 * specify estimated just say you did better than xx% of players today with a histogram").
 */
export function ParBlock({ list, score, id, today = false }: { list: ListPar; score: number; id?: string; today?: boolean }) {
  const real = useListStats(id, "list");
  const counts = blendCounts(list.counts, real);
  // (Null only for an entry with no counts at all, which par.json never has.)
  const { p, estimated } = standing(list.counts, real, score) ?? { p: 0, estimated: true };
  const avg = Math.round((blendAverage(list.par, real) ?? list.par) * 10) / 10;
  return (
    <div
      className="par-block"
      data-testid="par"
      data-par={avg}
      data-p={p}
      data-source={estimated ? "estimate" : "players"}
      data-n={real?.n}
    >
      <div className="par-row">
        <p className="par-stat">
          <span className="label">Players avg</span>
          <b>{avg}</b>
        </p>
        {/* A score is the middle of its bin on the curve's scale (0 to 11 bins). */}
        <CrowdCurve
          counts={counts}
          you={score + 0.5}
          avg={avg + 0.5}
          top={10}
          label={`You did ${playersLine(p, today)}: you got ${score} of 10, players average ${avg}.`}
        />
      </div>
      <p className="par-line" data-testid="par-line">
        {/* One text node: split nodes shape the pixel font a little differently. */}
        <span>{playersLine(p, today)}</span>
      </p>
    </div>
  );
}
