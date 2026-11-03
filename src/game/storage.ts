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

/** Why a list wasn't good, after a thumbs down: the game's fixed set (RATING_REASONS in src/net/ratings.ts). */
export type RatingReason = "too-hard" | "too-easy" | "boring" | "unfair" | "wrong-data";

/** The player's own rating of a list in a mode: 1 good, -1 not, 0 taken back (kept, so the latest wins in a sync). */
export interface ListRating {
  rating: -1 | 0 | 1;
  /** Only with -1. */
  reason?: RatingReason;
  /** Epoch ms it was given. */
  at: number;
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
  /**
   * The first finished try on each list, per mode, never pruned: what stats count, so replaying a list can't raise
   * them. Written when a list's first run is recorded; older saves get it from their oldest run on load.
   */
  firstTries?: { list?: Record<string, ListRun>; blitz?: Record<string, BlitzRun> };
  /** "Good list?" on the results: `${mode}:${listId}` -> the player's latest rating (mode: list or blitz). */
  ratings?: Record<string, ListRating>;
}

const empty = (): Saved => ({ games: {}, daily: {}, seenHelp: false });

export function load(): Saved {
  try {
    const s: Saved = { ...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    // Early builds keyed the daily by day number; those entries can't count toward date-based streaks.
    for (const k of Object.keys(s.daily)) if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) delete s.daily[k];
    return withFirstTries(s);
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

/**
 * Fill in first tries a save doesn't have yet from what it remembers: the oldest finished game of each list (from the
 * run history, the locked dailies and the list's own save) and the oldest Blitz round of each list. Existing first
 * tries are never replaced.
 */
export function withFirstTries(s: Saved): Saved {
  const list: Record<string, ListRun> = { ...s.firstTries?.list };
  const blitz: Record<string, BlitzRun> = { ...s.firstTries?.blitz };
  let added = false;
  const games = [...Object.values(s.dailyGames ?? {}), ...Object.values(s.games)];
  const candidates: ListRun[] = [...(s.listRuns ?? [])];
  for (const g of games) {
    if (g.status === "playing") continue;
    // Games saved before timestamps existed count as the oldest try.
    const startedAt = g.startedAt ?? 0;
    candidates.push({ id: g.puzzleId, startedAt, finishedAt: g.finishedAt ?? startedAt, status: g.status, found: g.found, lives: g.lives, hints: g.hints?.length ?? 0 });
  }
  for (const r of candidates) {
    if (s.firstTries?.list?.[r.id]) continue;
    if (!list[r.id] || r.startedAt < list[r.id].startedAt) {
      list[r.id] = r;
      added = true;
    }
  }
  for (const [id, runs] of Object.entries(s.blitzRuns ?? {})) {
    if (s.firstTries?.blitz?.[id] || !runs.length) continue;
    blitz[id] = runs.reduce((a, b) => (b.startedAt < a.startedAt ? b : a));
    added = true;
  }
  return added ? { ...s, firstTries: { list, blitz } } : s;
}

/** Played, perfect games, average found and the 0-10 spread: first tries only, so replays can't inflate them. */
export function stats(s: Saved): Stats {
  const done = Object.values(withFirstTries(s).firstTries?.list ?? {});
  const dist = Array(11).fill(0);
  for (const g of done) dist[g.found.length]++;
  return {
    played: done.length,
    perfect: dist[10],
    avgFound: done.length ? done.reduce((n, g) => n + g.found.length, 0) / done.length : 0,
    dist,
  };
}
