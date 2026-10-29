import type { BlitzRun } from "./blitz";
import type { GameState } from "./state";
import type { Saved } from "./storage";

/** A finished list game, as kept in the player's history. */
export interface ListRun {
  id: string;
  startedAt: number;
  finishedAt: number;
  status: "won" | "lost" | "gave-up";
  found: number[];
  lives: number;
  hints: number;
  /** Daily number when it was a daily (today's or from the archive). */
  daily?: number;
}

/** How many finished list games are kept. */
export const MAX_LIST_RUNS = 100;

/**
 * Record a finished list game in the history (newest first, capped). The same game recorded twice (same list and
 * startedAt) is a no-op, so the UI can call this whenever a finished game is shown. Unfinished or undated games
 * (saves from before timestamps existed) are skipped.
 */
export function recordListRun(saved: Saved, game: GameState, daily?: number): Saved {
  if (game.status === "playing" || !game.startedAt || !game.finishedAt) return saved;
  const runs = saved.listRuns ?? [];
  if (runs.some((r) => r.id === game.puzzleId && r.startedAt === game.startedAt)) return saved;
  const run: ListRun = {
    id: game.puzzleId,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    status: game.status,
    found: game.found,
    lives: game.lives,
    hints: game.hints?.length ?? 0,
    ...(daily ? { daily } : {}),
  };
  return { ...saved, listRuns: [run, ...runs].slice(0, MAX_LIST_RUNS) };
}

export type Play =
  | { kind: "list"; id: string; at: number; run: ListRun }
  | { kind: "blitz"; id: string; at: number; run: BlitzRun; today?: boolean };

/**
 * Everything played, list games and Blitz rounds alike, newest first. A Blitz round is marked `today` when it was
 * the round that counted as that date's Today's Blitz.
 */
export function recentPlays(saved: Saved, limit = 50): Play[] {
  const plays: Play[] = (saved.listRuns ?? []).map((run) => ({ kind: "list", id: run.id, at: run.finishedAt, run }));
  const daily = Object.values(saved.blitzDaily ?? {});
  for (const [id, runs] of Object.entries(saved.blitzRuns ?? {})) {
    for (const run of runs) {
      const today = daily.some((d) => d.id === id && d.score === run.score && d.answers === run.hits.length);
      plays.push({ kind: "blitz", id, at: run.endedAt, run, ...(today ? { today } : {}) });
    }
  }
  return plays.sort((a, b) => b.at - a.at).slice(0, limit);
}
