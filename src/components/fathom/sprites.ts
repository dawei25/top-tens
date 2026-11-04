/** Fathom's pixel marks ("#" = on), shared by the sonar gauge and the reveal's labels. */

/** The answer: a gold buoy, a diamond on a pole. */
export const BUOY = ["..#..", ".###.", "#####", ".###.", "..#.."];

/** Your guess: a small squid, 7 x 8 (mantle, two eyes, arms). */
export const SQUID = ["..###..", ".#####.", ".#####.", "##.#.##", "#######", "#.#.#.#", "#.#.#.#", ".#...#."];

/** A pixel map as an SVG path, its top left cell at (x0, y0). */
export function placed(rows: readonly string[], x0 = 0, y0 = 0): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") d += `M${x0 + x} ${y0 + y}h1v1h-1z`;
  });
  return d;
}
