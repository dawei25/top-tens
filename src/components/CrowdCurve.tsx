import { columnAt, columnHeights, COLS, CURVE_H, CURVE_W, markerAt, PIXEL, stepPath } from "./crowd-curve";

/**
 * How players scored, as a stepped pixel curve (crowd-curve.ts): the area in the bars' slate, a little brighter from
 * the left edge to the player's score (the players they did better than), a thin pink line and a pink square on the
 * curve where the player is, the average's gold caret under the baseline, and the scale's ends under it (0 and 10 on a
 * list, 0 and 1000 on Today's Fathom). The same place and size as the 11 bars it replaces; nothing to hover.
 *
 * `you` and `avg` are positions on the bins' scale, 0 to counts.length (a list's score 5 is 5.5, the middle of its
 * bin; a Fathom total of 712 is 71.2 bins of 10). `label` says it in words for a screen reader.
 */
export function CrowdCurve({ counts, you, avg, top, label }: { counts: number[]; you: number; avg: number; top: number; label: string }) {
  const n = counts.length;
  const heights = columnHeights(counts);
  const marker = markerAt(heights, columnAt(you, n));
  const mean = columnAt(avg, n);
  return (
    <div className="histogram crowd-curve" data-testid="crowd-curve" data-cols={COLS} data-you={marker.col} data-avg={mean} role="img" aria-label={label}>
      <div className="curve-plot">
        <div className="curve-area">
          <svg width={CURVE_W} height={CURVE_H} viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} shapeRendering="crispEdges" aria-hidden="true">
            <path className="curve-fill" d={stepPath(heights)} />
            <path className="curve-below" data-testid="curve-below" d={stepPath(heights, 0, marker.col)} />
            <rect className="curve-line" x={marker.col * PIXEL} y={CURVE_H - heights[marker.col]} width={2} height={heights[marker.col]} />
          </svg>
          <span className="curve-you" data-testid="curve-you" data-col={marker.col} style={{ left: marker.left, top: marker.top }} />
          <span className="curve-avg" data-testid="curve-avg" data-col={mean} style={{ left: mean * PIXEL - 3 }} />
        </div>
      </div>
      <div className="histo-axis" aria-hidden="true">
        <span>0</span>
        <span>{top}</span>
      </div>
    </div>
  );
}
