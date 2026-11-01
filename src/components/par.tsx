import { useEffect, useState } from "react";
import { loadPar, percentile, percentileLabel, type ListPar, type ParFile } from "../game/par";
import { useListStats } from "../net";
import { formatCount, pickCounts } from "../net/crowd";

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

/** "+2", "-0.5", "0": a score's distance from par, one decimal for averages. */
export function signed(n: number, decimals = 0): string {
  const v = Number(n.toFixed(decimals));
  return v > 0 ? `+${v.toFixed(decimals)}` : v < 0 ? `-${Math.abs(v).toFixed(decimals)}` : (0).toFixed(decimals);
}

/** "+2 vs par", "-1 vs par", "at par". */
export function vsParText(diff: number, decimals = 0): string {
  return Number(diff.toFixed(decimals)) === 0 ? "at par" : `${signed(diff, decimals)} vs par`;
}

export const ESTIMATE_NOTE = "estimated from test players until real scores come in";

/** The "est." mark on numbers from the synthetic crowd: hover for the note, or tap to read it inline. */
export function Est() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="est"
        title={ESTIMATE_NOTE}
        aria-label={`est.: ${ESTIMATE_NOTE}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        est.
      </button>
      {open && <span className="est-note">{ESTIMATE_NOTE}</span>}
    </>
  );
}

/** Bar heights snap to this many px, so the histogram stays on the pixel grid. */
const STEP = 3;
const MAX_H = 42;

/** 11 bars for scores 0 to 10: the player's bar lit, a caret under par. */
export function ParHistogram({ counts, par, score }: { counts: number[]; par: number; score: number }) {
  const max = Math.max(1, ...counts);
  return (
    <div
      className="histogram"
      data-testid="histogram"
      role="img"
      aria-label={`How players score on this list, 0 to 10: par is ${par}, you got ${score}.`}
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
              data-par={i === par || undefined}
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
 * The results panel's par block: par, the histogram, and where the score stands. With a backend (and the list's id),
 * real players' scores replace the estimate once enough of them have finished the list ("of 1,203 players").
 */
export function ParBlock({ list, score, id }: { list: ListPar; score: number; id?: string }) {
  const { counts, real } = pickCounts(list.counts, useListStats(id, "list"));
  const p = percentile(counts, score);
  return (
    <div className="par-block" data-testid="par" data-par={list.par} data-source={real ? "players" : "estimate"} data-n={real?.n}>
      <div className="par-row">
        <p className="par-stat">
          <span className="label">Par</span>
          <b>{list.par}</b>
        </p>
        <ParHistogram counts={counts} par={list.par} score={score} />
      </div>
      <p className="par-line">
        <span>
          {percentileLabel(p)} of {real ? `${formatCount(real.n)} players` : "players"}
        </span>{" "}
        {!real && list.estimated && <Est />}
      </p>
    </div>
  );
}
