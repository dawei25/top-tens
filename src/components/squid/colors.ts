/**
 * Each limb's own light, by rank: a bioluminescent ramp from gold (#1) through lime, mint, cyan and blue to violet and
 * pink (#10), so ten lit limbs read as ten. The found row's rank numeral takes the same colour (squid.css: --limb-N),
 * and every one keeps 5:1 or better on the glass panels with white right behind them.
 * Keep in step with the --limb-N custom properties in squid.css.
 */
export const LIMB_COLORS = [
  "#ffd166",
  "#b6f36a",
  "#5cf2a8",
  "#4de3ff",
  "#5cb8ff",
  "#8a9cff",
  "#b28bff",
  "#e07bff",
  "#ff6fc0",
  "#ff5d8f",
] as const;

export const limbColor = (rank: number) => LIMB_COLORS[Math.min(9, Math.max(0, rank - 1))];

/** A colour mixed toward another, 0-1 (hex in, hex out). */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
