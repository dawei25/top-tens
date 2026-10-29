import type { GameState } from "./state";

const KEY = "top-tens:v1";

export interface Saved {
  games: Record<string, GameState>;
  /** Day number -> puzzle id finished on that day in daily mode. */
  daily: Record<number, string>;
  seenHelp: boolean;
}

const empty = (): Saved => ({ games: {}, daily: {}, seenHelp: false });

export function load(): Saved {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return empty();
  }
}

export function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or storage full: progress just isn't remembered.
  }
}

export interface Stats {
  played: number;
  perfect: number;
  avgFound: number;
  dist: number[];
}

export function stats(s: Saved): Stats {
  const done = Object.values(s.games).filter((g) => g.status !== "playing");
  const dist = Array(11).fill(0);
  for (const g of done) dist[g.found.length]++;
  return {
    played: done.length,
    perfect: dist[10],
    avgFound: done.length ? done.reduce((n, g) => n + g.found.length, 0) / done.length : 0,
    dist,
  };
}
