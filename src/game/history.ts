import { isDailyBlitzRun, type BlitzRun } from "./blitz";
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
  const firstTries = saved.firstTries?.list?.[run.id]
    ? saved.firstTries
    : { ...saved.firstTries, list: { ...saved.firstTries?.list, [run.id]: run } };
  return { ...saved, listRuns: [run, ...runs].slice(0, MAX_LIST_RUNS), firstTries };
}

/** Each list's first finished try (what stats count), oldest first. */
export function firstListRuns(saved: Saved): ListRun[] {
  return Object.values(saved.firstTries?.list ?? {}).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Clear a list's saved game so the next visit starts fresh (a random roll always does). A finished game is already
 * in the history; an unfinished one is dropped.
 */
export function freshList(saved: Saved, id: string): Saved {
  if (!saved.games[id]) return saved;
  const games = { ...saved.games };
  delete games[id];
  return { ...saved, games };
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
      const today = daily.some((d) => !d.late && isDailyBlitzRun(d, id, run));
      plays.push({ kind: "blitz", id, at: run.endedAt, run, ...(today ? { today } : {}) });
    }
  }
  return plays.sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * When each list was last played in a mode (list id -> epoch ms), so random rolls can prefer lists the player hasn't
 * seen. A list game saved without a run (older saves) counts as played long ago.
 */
export function lastPlayed(saved: Saved, mode: "list" | "blitz"): Map<string, number> {
  const out = new Map<string, number>();
  const note = (id: string, t: number) => out.set(id, Math.max(out.get(id) ?? 0, t));
  if (mode === "blitz") {
    for (const [id, runs] of Object.entries(saved.blitzRuns ?? {})) for (const r of runs) note(id, r.endedAt);
    return out;
  }
  for (const r of saved.listRuns ?? []) note(r.id, r.finishedAt);
  for (const [id, g] of Object.entries(saved.games)) if (g.status !== "playing") note(id, 0);
  return out;
}
