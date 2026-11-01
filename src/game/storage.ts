import type { BlitzRun, BlitzState } from "./blitz";
import type { ListRun } from "./history";
import type { GameState } from "./state";

export interface DailyBlitzResult {
  id: string;
  score: number;
  answers: number;
  /** The round's startedAt, to find it in blitzRuns. */
  startedAt?: number;
  late?: boolean;
}

const KEY ="top-tens:v1";

export interface Saved {
  games: Record<string, GameState>;
  /** Local date (YYYY-MM-DD) -> id of that date's daily, finished on that date. Drives streaks. */
  daily: Record<string, string>;
  seenHelp: boolean;
  /** Best Blitz score per list id. */
  blitzBest?: Record<string, number>;
  /** Finished Blitz rounds per list id, newest first, capped (see MAX_BLITZ_RUNS in blitz.ts). */
  blitzRuns?: Record<string, BlitzRun[]>;
  /**
   * Today's Blitz results by date: one round each, the first one finished. `late` marks a round played after its
   * date (from a link), which locks it the same way but isn't a Today's Blitz. Older entries lack startedAt.
   */
  blitzDaily?: Record<string, DailyBlitzResult>;
  /**
   * Finished dailies by date (on the day or later, from the archive): one try each, so a date in here stays locked
   * even after a roll replays the same list. Older saves only have the list's game in `games`.
   */
  dailyGames?: Record<string, GameState>;
  /** Finished list games, newest first, capped (see MAX_LIST_RUNS in history.ts). Survives Play again. */
  listRuns?: ListRun[];
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
