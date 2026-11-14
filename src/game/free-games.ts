import { isDailyBlitzRun } from "./blitz";
import type { DailyEntry } from "./daily";
import type { GameState } from "./state";
import type { Saved } from "./storage";

/**
 * Free play without an account (owner, Nov 14: "after a user plays more than once in free play, they have to sign in
 * with google to continue playing"): how many free-play games (Random list, Random Blitz, a link or Play again to a
 * list) a player may start before the next one asks them to sign in. One number, so it can be tuned here.
 */
export const FREE_GAMES_BEFORE_SIGN_IN = 2;

/**
 * A list game the player has played, not only opened: a guess the list took (an answer, or a life lost: a free miss
 * leaves nothing in the save), a clue, or an end (a give-up included).
 */
export function listGamePlayed(g: GameState): boolean {
  return g.status !== "playing" || g.log.length > 0 || (g.hints?.length ?? 0) > 0;
}

/**
 * Whether a list game under way in the list's own save may be a daily's: today's list, or an archive day's list whose
 * game isn't locked yet (a daily shares that save until it's finished). Counted as a daily, so a daily never counts.
 */
function mayBeDaily(id: string, saved: Saved, schedule: readonly Pick<DailyEntry, "date" | "id">[], today: string): boolean {
  return schedule.some((e) => e.id === id && e.date <= today && !saved.dailyGames?.[e.date]);
}

/**
 * The free-play games this save has played, each once: finished list games that weren't a daily, list games under way
 * with a guess the list took, a clue or a give-up, and Blitz rounds whose clock started (under way or finished), but
 * never a round of the old Today's Blitz. Opening a game and leaving it untouched never counts. From the local save
 * alone: a reset starts the count again, and a sync brings in another device's games (an account plays freely anyway).
 */
export function freeGamesPlayed(saved: Saved, schedule: readonly Pick<DailyEntry, "date" | "id">[], today: string): number {
  const seen = new Set<string>();
  for (const r of saved.listRuns ?? []) if (!r.daily) seen.add(`list:${r.id}:${r.startedAt}`);
  for (const g of Object.values(saved.games ?? {})) {
    if (g.status !== "playing" || !listGamePlayed(g) || mayBeDaily(g.puzzleId, saved, schedule, today)) continue;
    seen.add(`list:${g.puzzleId}:${g.startedAt ?? 0}`);
  }
  const dailyRounds = Object.values(saved.blitzDaily ?? {});
  for (const [id, runs] of Object.entries(saved.blitzRuns ?? {})) {
    for (const r of runs) if (!dailyRounds.some((d) => isDailyBlitzRun(d, id, r))) seen.add(`blitz:${id}:${r.startedAt}`);
  }
  for (const [id, s] of Object.entries(saved.blitzLive ?? {})) if (s?.startedAt) seen.add(`blitz:${id}:${s.startedAt}`);
  return seen.size;
}

/**
 * Whether starting a new free-play game asks the player to sign in first: a build with accounts, signed out, and
 * `limit` free games played already. Signed in, free play never runs out; dailies are never asked about.
 */
export function signInToPlay(
  saved: Saved,
  o: { schedule: readonly Pick<DailyEntry, "date" | "id">[]; today: string; signedIn: boolean; accounts: boolean; limit?: number },
): boolean {
  if (!o.accounts || o.signedIn) return false;
  return freeGamesPlayed(saved, o.schedule, o.today) >= (o.limit ?? FREE_GAMES_BEFORE_SIGN_IN);
}

/**
 * Whether opening list `id` in a mode shows a game already played there instead of starting a new one: a list game
 * under way resumes and a finished one shows its result; a Blitz round whose clock started resumes. Such a visit is
 * never asked about.
 */
export function opensPlayedGame(saved: Saved, mode: "list" | "blitz", id: string): boolean {
  if (mode === "blitz") return !!saved.blitzLive?.[id]?.startedAt;
  const g = saved.games?.[id];
  return !!g && listGamePlayed(g);
}
