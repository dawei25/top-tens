import type { FathomQuestion } from "../game/fathom";
import type { OutboxKind } from "./outbox";

/**
 * Fathom (the estimation beta): each locked-in guess, sent so a reveal can say how real players guessed (and so a
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
