import type { DailyEntry } from "./daily";
import type { Lexicon } from "./junk";
import { judgeGuess } from "./match";
import type { Saved } from "./storage";
import type { Entry, Puzzle } from "./types";

/**
 * Blitz: a timed way to play a list. No lives, no 10-answer cap: every answer with a stat scores, bigger stats
 * score more, and anything else costs only the time spent typing it.
 */

/** Round length. One constant so it can be tuned. */
export const BLITZ_SECONDS = 90;

export type Scoring = "sqrt" | "linear";
/** Which curve turns a stat into points. Both give every answer at least 10 and the #1 answer 100. */
export const SCORING: Scoring = "sqrt";

/** Points for a stat `n` on a list whose biggest stat is `top`: 10 to 100. */
export function points(n: number, top: number, scoring: Scoring = SCORING): number {
  if (!(n > 0) || !(top > 0)) return 10;
  const share = Math.min(1, n / top);
  return Math.round(10 + 90 * (scoring === "sqrt" ? Math.sqrt(share) : share));
}

/** The list's biggest stat (normally #1's). */
export function topValue(puzzle: Puzzle): number {
  let top = 0;
  for (const e of [...puzzle.answers, ...puzzle.extras]) if (e.n && e.n > top) top = e.n;
  return top;
}

export interface BlitzHit {
  name: string;
  rank: number;
  n: number;
  points: number;
}

export interface BlitzState {
  puzzleId: string;
  /** Epoch ms of the first keystroke; the clock doesn't run before it. */
  startedAt?: number;
  /** Epoch ms the round ended (time ran out). */
  endedAt?: number;
  hits: BlitzHit[];
}

export type BlitzResult =
  | { kind: "empty" }
  | { kind: "scored"; hit: BlitzHit; corrected: boolean }
  | { kind: "duplicate"; name: string }
  | { kind: "choices"; suggestions: string[] }
  /** Not on this list, or on it without a stat: scores nothing, costs nothing. */
  | { kind: "none"; junk: boolean }
  | { kind: "over" };

export function newBlitz(puzzle: Puzzle): BlitzState {
  return { puzzleId: puzzle.id, hits: [] };
}

/** Start the clock (on the first keystroke). Starting twice keeps the first start. */
export function startBlitz(state: BlitzState, now = Date.now()): BlitzState {
  return state.startedAt ? state : { ...state, startedAt: now };
}

/** Milliseconds left; the full round before the first keystroke, 0 once over. */
export function timeLeft(state: BlitzState, now = Date.now()): number {
  if (state.endedAt) return 0;
  if (!state.startedAt) return BLITZ_SECONDS * 1000;
  return Math.max(0, state.startedAt + BLITZ_SECONDS * 1000 - now);
}

export function isOver(state: BlitzState, now = Date.now()): boolean {
  return !!state.endedAt || (!!state.startedAt && timeLeft(state, now) === 0);
}

/** Lock the round once time is up. */
export function finishBlitz(state: BlitzState, now = Date.now()): BlitzState {
  if (state.endedAt) return state;
  return { ...state, endedAt: state.startedAt ? Math.min(now, state.startedAt + BLITZ_SECONDS * 1000) : now };
}

export function blitzScore(state: BlitzState): number {
  return state.hits.reduce((sum, h) => sum + h.points, 0);
}

/**
 * Judge a Blitz guess with the main game's matcher. A clear typo counts at once (there's no life to protect, and
 * a second Enter costs time); ambiguous names still offer choices. Only entries with a stat score.
 */
export function blitzGuess(
  state: BlitzState,
  puzzle: Puzzle,
  text: string,
  lex?: Lexicon,
  offered?: string[],
  now = Date.now(),
): { state: BlitzState; result: BlitzResult } {
  if (isOver(state, now)) return { state: finishBlitz(state, now), result: { kind: "over" } };
  // Found ranks are irrelevant here: duplicates are tracked by name below.
  const r = judgeGuess(text, puzzle, new Set(), lex, offered);
  if (r.kind === "empty") return { state, result: r };
  if (r.kind === "typo") return { state, result: { kind: "choices", suggestions: r.suggestions } };
  if (r.kind === "unknown") return { state, result: { kind: "none", junk: r.junk } };
  if (r.kind === "duplicate" || r.kind === "correct" || r.kind === "near") {
    const entry: Entry = r.entry;
    if (state.hits.some((h) => h.name === entry.name)) return { state, result: { kind: "duplicate", name: entry.name } };
    if (entry.n === undefined) return { state, result: { kind: "none", junk: false } };
    const hit: BlitzHit = { name: entry.name, rank: entry.rank, n: entry.n, points: points(entry.n, topValue(puzzle)) };
    const corrected = r.kind === "duplicate" ? false : r.corrected;
    return { state: { ...startBlitz(state, now), hits: [...state.hits, hit] }, result: { kind: "scored", hit, corrected } };
  }
  return { state, result: { kind: "none", junk: false } };
}

/** The biggest answers the player didn't get, for the results screen. */
export function missedTop(puzzle: Puzzle, state: BlitzState, k = 10): Entry[] {
  const got = new Set(state.hits.map((h) => h.name));
  return [...puzzle.answers, ...puzzle.extras]
    .filter((e) => e.n !== undefined && !got.has(e.name))
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
    .slice(0, k);
}

/**
 * Blitz shows every answer at the end, so it would spoil a daily: today's list is blocked until that daily is
 * finished, and lists scheduled for later dates are blocked until their day has passed and been played or skipped.
 */
export function blitzAvailable(puzzle: Pick<Puzzle, "id" | "blitz">, schedule: DailyEntry[], today: string, saved: Saved): boolean {
  if (!puzzle.blitz) return false;
  for (const e of schedule) {
    if (e.id !== puzzle.id) continue;
    if (e.date > today) return false;
    if (e.date === today) {
      const g = saved.games[e.id];
      if (!g || g.status === "playing") return false;
    }
  }
  return true;
}

/** A finished round, as kept in the player's history. */
export interface BlitzRun {
  /** Epoch ms the round started; also its id. */
  startedAt: number;
  endedAt: number;
  score: number;
  hits: BlitzHit[];
}

/** How many finished rounds are kept per list. */
export const MAX_BLITZ_RUNS = 20;

/**
 * Record a finished round: its best-score check and its place in the history (newest first, capped). Clears the
 * saved in-progress round. Recording the same round twice (same startedAt) is a no-op.
 */
export function recordBlitz(
  saved: Saved,
  puzzleId: string,
  state: BlitzState,
): { saved: Saved; best: boolean; previous?: number } {
  const score = blitzScore(state);
  const runs = saved.blitzRuns?.[puzzleId] ?? [];
  const startedAt = state.startedAt ?? state.endedAt ?? Date.now();
  const live = { ...saved.blitzLive };
  delete live[puzzleId];
  const previous = saved.blitzBest?.[puzzleId];
  if (runs.some((r) => r.startedAt === startedAt)) {
    return { saved: { ...saved, blitzLive: live }, best: false, previous };
  }
  const best = previous === undefined || score > previous;
  const run: BlitzRun = { startedAt, endedAt: state.endedAt ?? Date.now(), score, hits: state.hits };
  return {
    saved: {
      ...saved,
      blitzBest: best ? { ...saved.blitzBest, [puzzleId]: score } : saved.blitzBest,
      blitzRuns: { ...saved.blitzRuns, [puzzleId]: [run, ...runs].slice(0, MAX_BLITZ_RUNS) },
      blitzLive: live,
    },
    best,
    previous,
  };
}

/** Save a round in progress (after the first keystroke and after every hit). */
export function saveLiveBlitz(saved: Saved, state: BlitzState): Saved {
  if (!state.startedAt || state.endedAt) return saved;
  return { ...saved, blitzLive: { ...saved.blitzLive, [state.puzzleId]: state } };
}

/**
 * The saved round for a list when the player comes back: still running (resume it, the clock never stopped), or
 * already over (finished here, so the caller records it and shows its results). Undefined if there is none.
 */
export function resumeBlitz(saved: Saved, puzzleId: string, now = Date.now()): { state: BlitzState; over: boolean } | undefined {
  const live = saved.blitzLive?.[puzzleId];
  if (!live?.startedAt) return undefined;
  if (isOver(live, now)) return { state: finishBlitz(live, now), over: true };
  return { state: live, over: false };
}

/** Finished rounds on a list, newest first. */
export function blitzHistory(saved: Saved, puzzleId: string): BlitzRun[] {
  return saved.blitzRuns?.[puzzleId] ?? [];
}

/** "Top Tens Blitz: Busiest airports · 742 pts · 14 answers" plus a link. */
export function blitzShareText(state: BlitzState, puzzle: Puzzle, url: string): string {
  const n = state.hits.length;
  return `Top Tens Blitz: ${puzzle.title}\n${blitzScore(state)} pts · ${n} answer${n === 1 ? "" : "s"} in ${BLITZ_SECONDS}s\n${url}`;
}
