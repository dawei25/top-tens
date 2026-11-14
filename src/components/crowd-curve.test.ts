// The players' curve (owner, Nov 14: "for histogram instead of a bar chart style can you do a actual curve?"): the
// smoothing keeps the counts' area, never goes negative or invents a bump, peaks where the counts peak, and the
// player's marker sits on the curve at their score, never clipped.
import { describe, expect, it } from "vitest";
import { simulatedCounts } from "../game/fathom-crowd";
import { columnAt, columnDensities, columnHeights, COLS, CURVE_H, CURVE_W, densityAt, markerAt, PIXEL, stepPath } from "./crowd-curve";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/** A list's players by score, 0 to 10 (backend-lib's STATS.list). */
const LIST = [2, 4, 8, 12, 16, 20, 18, 14, 12, 8, 6];
const FATHOM = simulatedCounts(485);
const argmax = (xs: readonly number[]) => xs.indexOf(Math.max(...xs));
/** Up then down (or flat): one peak, however wide. */
function unimodal(xs: readonly number[]): boolean {
  let i = 0;
  while (i + 1 < xs.length && xs[i + 1] >= xs[i]) i++;
  while (i + 1 < xs.length && xs[i + 1] <= xs[i]) i++;
  return i === xs.length - 1;
}

describe("the smoothing", () => {
  it("keeps the area: as many players under the curve as in the counts", () => {
    for (const counts of [LIST, FATHOM, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30], [30, ...Array(10).fill(0)], Array(11).fill(0)]) {
      const n = counts.length;
      const steps = 4000;
      let area = 0;
      for (let s = 0; s < steps; s++) area += densityAt(counts, ((s + 0.5) * n) / steps) * (n / steps);
      expect(Math.abs(area - sum(counts)), `${n} bins`).toBeLessThan(0.005 * Math.max(1, sum(counts)));
      // The columns too, read as their average density.
      expect(Math.abs(sum(columnDensities(counts)) * (n / COLS) - sum(counts))).toBeLessThan(0.01 * Math.max(1, sum(counts)));
    }
  });

  it("is never negative, and its columns are whole pixels within the curve's height", () => {
    for (const counts of [LIST, FATHOM, [0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]]) {
      expect(columnDensities(counts).every((d) => d >= 0)).toBe(true);
      const h = columnHeights(counts);
      expect(h).toHaveLength(COLS);
      expect(h.every((x) => x >= 0 && x <= CURVE_H && x % PIXEL === 0)).toBe(true);
      expect(Math.max(...h)).toBe(CURVE_H);
    }
  });

  it("peaks where the counts peak", () => {
    // A list's peak at 5 out of 10: the curve's top in bin 5's columns.
    const listTop = argmax(columnDensities(LIST));
    expect(listTop).toBeGreaterThanOrEqual(Math.floor((5 / 11) * COLS));
    expect(listTop).toBeLessThanOrEqual(Math.floor((6 / 11) * COLS));
    // Today's Fathom: within two columns (40 points) of the counts' peak.
    expect(Math.abs(argmax(columnDensities(FATHOM)) - Math.floor((argmax(FATHOM) / 100) * COLS))).toBeLessThanOrEqual(2);
  });

  it("never invents a bump: one peak stays one, rising counts stay a rising curve", () => {
    expect(unimodal(columnHeights(LIST))).toBe(true);
    expect(unimodal(columnHeights(FATHOM))).toBe(true);
    const rising = columnHeights([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(rising.every((h, i) => i === 0 || h >= rising[i - 1])).toBe(true);
    // Everyone at one score: one bump around it, nothing far from it.
    const one = columnHeights([0, 0, 0, 0, 0, 0, 0, 40, 0, 0, 0]);
    expect(unimodal(one)).toBe(true);
    expect(argmax(one)).toBeGreaterThanOrEqual(Math.floor((7 / 11) * COLS));
    expect(argmax(one)).toBeLessThanOrEqual(Math.floor((8 / 11) * COLS));
    expect(one.slice(0, 15).every((h) => h === 0)).toBe(true);
  });

  it("draws nothing for nobody", () => {
    expect(columnHeights(Array(11).fill(0)).every((h) => h === 0)).toBe(true);
  });
});

describe("the player's marker", () => {
  it("is in the column of their score, on the curve", () => {
    const h = columnHeights(LIST);
    for (const score of [0, 3, 5, 10]) {
      const m = markerAt(h, columnAt(score + 0.5, 11));
      expect(m.col).toBe(Math.floor(((score + 0.5) / 11) * COLS));
      // Its middle on the curve's top (within the square's half), unless that would put it off the curve.
      const top = CURVE_H - h[m.col];
      expect(Math.abs(m.top + 3 - top) <= 3 || m.top === 0 || m.top === CURVE_H - 6).toBe(true);
      expect(m.left + 3).toBeGreaterThanOrEqual(m.col * PIXEL - 1);
      expect(m.left + 3).toBeLessThanOrEqual((m.col + 1) * PIXEL + 1);
    }
  });

  it("is never clipped: a score of 0 or the maximum, a peak at the top, an empty column", () => {
    const h = columnHeights(FATHOM);
    for (const total of [0, 1000]) {
      const m = markerAt(h, columnAt(total / 10, 100));
      expect(m.col).toBe(total ? COLS - 1 : 0);
      expect(m.left).toBeGreaterThanOrEqual(0);
      expect(m.left + 6).toBeLessThanOrEqual(CURVE_W);
      expect(m.top).toBeGreaterThanOrEqual(0);
      expect(m.top + 6).toBeLessThanOrEqual(CURVE_H);
    }
    expect(markerAt(columnHeights([0, 0, 0, 0, 0, 40, 0, 0, 0, 0, 0]), columnAt(5.5, 11)).top).toBe(0);
    expect(markerAt(Array(COLS).fill(0), 0)).toEqual({ col: 0, left: 0, top: CURVE_H - 6 });
  });
});

describe("the path", () => {
  it("steps along the columns from the baseline and back", () => {
    const h = Array(COLS).fill(0).map((_, i) => (i === 1 ? 6 : 0));
    expect(stepPath(h, 0, 2)).toBe(`M0 ${CURVE_H}V${CURVE_H}H3V${CURVE_H - 6}H6V${CURVE_H}H9V${CURVE_H}Z`);
    expect(stepPath(h, 3, 2)).toBe("");
  });
});
