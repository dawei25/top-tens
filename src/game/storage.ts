import type { BlitzRun, BlitzState } from "./blitz";
import type { GameState } from "./state";

const KEY = "top-tens:v1";

export interface Saved {
  games: Record<string, GameState>;
  /** Local date (YYYY-MM-DD) -> id of that date's daily, finished on that date. Drives streaks. */
  daily: Record<string, string>;
  seenHelp: boolean;
  /** Best Blitz score per list id. */
  blitzBest?: Record<string, number>;
  /** Finished Blitz rounds per list id, newest first, capped (see MAX_BLITZ_RUNS in blitz.ts). */
  blitzRuns?: Record<string, BlitzRun[]>;
  /** A Blitz round in progress per list id, saved after every hit so leaving the page doesn't lose it. */
  blitzLive?: Record<string, BlitzState>;
}

const empty = (): Saved => ({ games: {}, daily: {}, seenHelp: false });

export function load(): Saved {
  try {
    const s: Saved = { ...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    // Early builds keyed the daily by day number; those entries can't count toward date-based streaks.
    for (const k of Object.keys(s.daily)) if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) delete s.daily[k];
    return s;
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
