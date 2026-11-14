/**
 * The players' curve (owner, Nov 14: "for histogram instead of a bar chart style can you do a actual curve? apply this
 * style throughout but keep it within thematic style"): how players scored, as a smooth curve drawn on the pixel grid.
 * The binned counts (a list's 11 scores, Today's Fathom's 100 bins of 10 points) are read as a density: each bin's
 * players spread evenly over its width, then a light Gaussian blur, reflected at both ends so nobody leaks off the
 * scale. That keeps the area the counts' and never adds a bump the bins don't have (a Gaussian blur makes no new peaks).
 * The density is then sampled in columns of one pixel (PIXEL wide) and its heights snapped to PIXEL steps: a stepped
 * pixel curve in the game's look, the size of the bars it replaces. Pure: CrowdCurve.tsx draws it.
 */

/** The game's pixel: the step the old bars' heights snapped to, now the curve's square. */
export const PIXEL = 3;
/** Columns across, and the curve's width and height in px (about the 11 bars' 152 x 42). */
export const COLS = 50;
export const CURVE_W = COLS * PIXEL;
export const CURVE_H = 13 * PIXEL;
/** The blur, in px: half a list bin (a list's 11 bins across CURVE_W), the same on every curve. */
const BLUR_PX = CURVE_W / 22;

/** The standard normal's cumulative distribution (Abramowitz and Stegun 7.1.26, within 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const tail = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 1 - tail / 2 : tail / 2;
}

/** The blur in bins for `n` bins across the curve. */
export const blurBins = (n: number): number => (BLUR_PX * n) / CURVE_W;

/**
 * Players per bin of width at `x` (in bins, 0 to n): every bin's players spread evenly over it, blurred by `h` bins,
 * reflected at 0 and n. Its integral over [0, n] is the number of players.
 */
export function densityAt(counts: readonly number[], x: number, h = blurBins(counts.length)): number {
  const n = counts.length;
  const at = (t: number) => {
    let d = 0;
    for (let i = 0; i < n; i++) if (counts[i] > 0) d += counts[i] * (phi((t - i) / h) - phi((t - i - 1) / h));
    return d;
  };
  return at(x) + at(-x) + at(2 * n - x);
}

/** Samples a column is read at (its average density, near enough for the curve). */
const SAMPLES = 8;

/** The density over each of COLS columns: their average players per bin of width. */
export function columnDensities(counts: readonly number[]): number[] {
  const n = counts.length;
  const h = blurBins(n);
  return Array.from({ length: COLS }, (_, j) => {
    let sum = 0;
    for (let s = 0; s < SAMPLES; s++) sum += densityAt(counts, ((j + (s + 0.5) / SAMPLES) * n) / COLS, h);
    return sum / SAMPLES;
  });
}

/** Each column's height in px, the highest CURVE_H, snapped to PIXEL steps (a column with players shows a step). */
export function columnHeights(counts: readonly number[]): number[] {
  const d = columnDensities(counts);
  const max = Math.max(...d);
  if (!(max > 0)) return d.map(() => 0);
  return d.map((v) => (v > 0 ? Math.max(v / max >= 0.02 ? PIXEL : 0, Math.round(((v / max) * CURVE_H) / PIXEL) * PIXEL) : 0));
}

/** The column a position falls in (in bins, 0 to n): the player's score, the average. Never off the curve. */
export const columnAt = (pos: number, n: number): number => Math.max(0, Math.min(COLS - 1, Math.floor((pos / n) * COLS)));

/** The stepped outline of columns `from` to `to` (inclusive), filled down to the baseline: an SVG path. */
export function stepPath(heights: readonly number[], from = 0, to = heights.length - 1): string {
  if (to < from) return "";
  let d = `M${from * PIXEL} ${CURVE_H}`;
  for (let j = from; j <= to; j++) d += `V${CURVE_H - heights[j]}H${(j + 1) * PIXEL}`;
  return `${d}V${CURVE_H}Z`;
}

/** Where the player's marker sits: its column, and its top-left in px (6 px square on the curve, never clipped). */
export function markerAt(heights: readonly number[], col: number): { col: number; left: number; top: number } {
  const c = Math.max(0, Math.min(COLS - 1, col));
  const left = Math.max(0, Math.min(CURVE_W - 6, c * PIXEL - 2));
  const top = Math.max(0, Math.min(CURVE_H - 6, CURVE_H - heights[c] - 3));
  return { col: c, left, top };
}
