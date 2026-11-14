import type { FathomQuestion } from "../game/fathom";
import type { CrowdStats } from "./crowd";
import type { OutboxKind } from "./outbox";
import { withinADay } from "./plays";

/**
 * Fathom (the estimation game): each locked-in guess, sent so a reveal can say how real players guessed (and so a
 * question can later be scored by how far off real players are). Only in a build with a backend (submit_fathom_guess
 * and fathom_compare, supabase/migrations/20261105130000_fathom_guesses.sql); without one nothing is sent or queued.
 * The database checks the same things, so keep the two in step. What the reveal says is playersLine in
 * src/game/fathom.ts (this file is in the main bundle; Fathom's own code isn't: only its types come from there).
 */

export interface FathomGuess {
  questionId: string;
  /**
   * The number locked in, in the question's unit, 0 or more (0% is a fair percent); on a name-it round, the figure of
   * the thing named (its population, its land borders: 0 for an island).
   */
  guess: number;
  /** Epoch ms it was locked in. */
  at: number;
}

const QUESTION_ID = /^[a-z0-9-]{1,64}$/;
/** Guesses at or past this are refused (the database's check: 0 or more, and under 1e300). */
export const MAX_GUESS = 1e300;

/** Why the server would refuse this guess, or null if it's fine. */
export function invalidGuess(g: FathomGuess): string | null {
  if (typeof g?.questionId !== "string" || !QUESTION_ID.test(g.questionId)) return "question id";
  if (typeof g.guess !== "number" || !(g.guess >= 0 && g.guess < MAX_GUESS)) return "guess";
  if (!Number.isFinite(g.at)) return "at";
  return null;
}

/**
 * Guesses in the outbox, named by question: the server keeps a browser's first guess on each, so once one has gone,
 * the same question drawn in a later game sends nothing.
 */
export const FATHOM_GUESSES: OutboxKind<FathomGuess> = {
  key: (g) => g.questionId,
  invalid: (g) => invalidGuess(g),
};

/** The arguments of the submit_fathom_guess database function. */
export function guessArgs(g: FathomGuess, clientId: string) {
  return { p_question_id: g.questionId, p_guess: g.guess, p_client_id: clientId };
}

/**
 * The scale fathom_compare measures "further off than you" on, by the question's round: how many times off for an
 * estimate and a name-it round on a ratio list (a population, an area), points, years or steps off for a percent, a
 * year and a name-it round on a steps list (land borders). The database knows these and no others.
 */
export const COMPARE_ROUNDS = ["estimate", "percent", "year", "name-ratio", "name-steps"] as const;
export type CompareRound = (typeof COMPARE_ROUNDS)[number];

/** A question's round as fathom_compare takes it: a name-it round with its list's scoring (by the ratio, as it scores). */
export function compareRound(q: Pick<FathomQuestion, "round" | "nameIt">): CompareRound {
  if (q.round === "name") return q.nameIt?.scoring === "steps" ? "name-steps" : "name-ratio";
  return q.round ?? "estimate";
}

/**
 * The arguments of fathom_compare: the question's round (the scale), the guess, the answer the game shows, and this
 * browser (left out of the crowd).
 */
export function compareArgs(questionId: string, round: CompareRound, guess: number, answer: number, clientId: string) {
  return { p_question_id: questionId, p_round: round, p_guess: guess, p_answer: answer, p_client_id: clientId };
}

/** What a comparison is cached and remembered under (src/net/service.ts), and read back by (useFathomCrowd). */
export const compareKey = (questionId: string, round: CompareRound, guess: number, answer: number): string =>
  `fathom:${round}:${questionId}:${guess}:${answer}`;

/** How real players guessed on a question: how many, their median guess, and the share further off than the guess. */
export interface FathomCrowd {
  n: number;
  median: number | null;
  /** 0 to 1. */
  furtherOff: number | null;
}

const num = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && Number.isFinite(+x) ? +x : null;

/** fathom_compare's answer ({"n", "median", "further_off"}), or null when it isn't one. */
export function parseCompare(raw: unknown): FathomCrowd | null {
  let r = raw;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      return null;
    }
  }
  if (typeof r !== "object" || r === null || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const n = num(o.n);
  if (n === null || n < 0 || !Number.isInteger(n)) return null;
  const median = o.median === null || o.median === undefined ? null : num(o.median);
  const furtherOff = o.further_off === null || o.further_off === undefined ? null : num(o.further_off);
  if (median !== null && !(median >= 0)) return null;
  if (furtherOff !== null && !(furtherOff >= 0 && furtherOff <= 1)) return null;
  return { n, median, furtherOff };
}

/* ---------- Today's Fathom: a day's totals ---------- */

/**
 * Today's Fathom, finished: the day's ten questions are the same for everyone, so its total (0 to 1,000) stands
 * against everyone else's that day ("you did better than 81% of players today"). Sent once per date, to
 * submit_fathom_play (supabase/migrations/20261114120000_fathom_plays.sql); the database checks the same things.
 */
export interface FathomPlay {
  /** The day it was that day's Fathom, played on its day: YYYY-MM-DD, the player's own date (game/daily's localDate). */
  date: string;
  /** The game's total, a whole number 0 to 1,000. */
  total: number;
  /** Epoch ms it finished. */
  at: number;
}

/** The most a game can total (ten questions of 100, since Nov 14). */
export const FATHOM_MAX_TOTAL = 1000;
/**
 * Totals are counted in bins this many points wide (0-9, 10-19, ...): 10, not 20, so two totals 10 points apart
 * rank apart...
 */
export const FATHOM_BIN = 10;
/** ...this many of them, 1,000 in the last with 990-999 (fathom_day_stats bins the same way). */
export const FATHOM_BINS = FATHOM_MAX_TOTAL / FATHOM_BIN;

/** The bin a total falls in: 0 for 0-9, 99 for 990 to 1,000. */
export const totalBin = (total: number): number => Math.max(0, Math.min(FATHOM_BINS - 1, Math.floor(total / FATHOM_BIN)));

/** Why the server would refuse this day's total, or null if it's fine. A date over a day from today has gone stale. */
export function invalidFathomPlay(p: FathomPlay, now = Date.now()): string | null {
  if (!withinADay(p?.date, now)) return "date";
  if (!Number.isInteger(p.total) || p.total < 0 || p.total > FATHOM_MAX_TOTAL) return "total";
  if (!Number.isFinite(p.at)) return "at";
  return null;
}

/** Day totals in the outbox, named by date: one per browser and day (the server keeps the first). */
export const FATHOM_PLAYS: OutboxKind<FathomPlay> = {
  key: (p) => p.date,
  invalid: (p, now) => invalidFathomPlay(p, now),
};

/** The arguments of the submit_fathom_play database function. */
export function fathomPlayArgs(p: FathomPlay, clientId: string) {
  return { p_date: p.date, p_total: p.total, p_client_id: clientId };
}

/** What a day's totals are cached and remembered under (src/net/service.ts), and read back by (useFathomDay). */
export const fathomDayKey = (date: string): string => `fathom-day:${date}`;

const count = (x: unknown): number | null => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : null);

/**
 * fathom_day_stats' answer ({"n", "counts", "avg"}: real players' totals that day, one per player, in FATHOM_BINS
 * bins), checked: null for anything malformed. Always FATHOM_BINS counts (a short answer is padded with 0s).
 */
export function parseFathomDay(raw: unknown): CrowdStats | null {
  let r = raw;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      return null;
    }
  }
  if (typeof r !== "object" || r === null || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const n = count(o.n);
  if (n === null || !Array.isArray(o.counts) || o.counts.length > FATHOM_BINS) return null;
  const raws: unknown[] = o.counts;
  const counts = Array.from({ length: FATHOM_BINS }, (_, i) => (i < raws.length ? count(raws[i]) : 0));
  // Every player is in one bin.
  if (counts.some((c) => c === null) || (counts as number[]).reduce((a, b) => a + b, 0) !== n) return null;
  const avg = o.avg === null || o.avg === undefined ? null : num(o.avg);
  if (avg !== null && !(avg >= 0 && avg <= FATHOM_MAX_TOTAL)) return null;
  return { n, counts: counts as number[], avg: n ? avg : null };
}
