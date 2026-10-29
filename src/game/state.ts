import type { Lexicon } from "./junk";
import { judgeGuess } from "./match";
import type { GuessResult, Puzzle } from "./types";

export const MAX_LIVES = 5;

export interface GuessLog {
  text: string;
  result: GuessResult;
}

export interface GameState {
  puzzleId: string;
  found: number[];
  lives: number;
  log: GuessLog[];
  status: "playing" | "won" | "lost" | "gave-up";
  /** Ranks whose first letter was bought with a life. */
  hints?: number[];
}

export function newGame(puzzle: Puzzle): GameState {
  return { puzzleId: puzzle.id, found: [], lives: MAX_LIVES, log: [], status: "playing" };
}

/** Only an accepted answer that isn't in the top 10 costs a life. */
export function costsLife(r: GuessResult): boolean {
  return r.kind === "near";
}

export function applyGuess(
  state: GameState,
  puzzle: Puzzle,
  text: string,
  lex?: Lexicon,
  offered?: string[],
): { state: GameState; result: GuessResult } {
  if (state.status !== "playing") return { state, result: { kind: "empty" } };
  const result = judgeGuess(text, puzzle, new Set(state.found), lex, offered);
  if (result.kind !== "correct" && result.kind !== "near") return { state, result };

  // Re-guessing an answer that already cost a life shouldn't cost another.
  if (result.kind === "near" && state.log.some((l) => l.result.kind === "near" && l.result.entry.name === result.entry.name)) {
    return { state, result: { kind: "duplicate", entry: result.entry } };
  }

  const found = result.kind === "correct" ? [...state.found, result.entry.rank] : state.found;
  const lives = costsLife(result) ? state.lives - 1 : state.lives;
  const status = found.length === puzzle.answers.length ? "won" : lives <= 0 ? "lost" : "playing";
  return { state: { ...state, found, lives, status, log: [...state.log, { text, result }] }, result };
}

/** The letter a hint reveals: the first letter or digit of the name, past a leading "The"/"A"/"An". */
export function hintLetter(name: string): string {
  const core = name.replace(/^(the|a|an)\s+/i, "");
  return (core.match(/[\p{L}\p{N}]/u)?.[0] ?? core[0] ?? "?").toUpperCase();
}

/** Whether a hint can be bought for this rank now: a hidden slot, not already hinted, and not on the last life. */
export function canHint(state: GameState, rank: number): boolean {
  return state.status === "playing" && state.lives > 1 && !state.found.includes(rank) && !(state.hints ?? []).includes(rank);
}

/** Spend one life to reveal the first letter of the answer at this rank. Never spends the last life. */
export function applyHint(state: GameState, rank: number): GameState {
  if (!canHint(state, rank)) return state;
  return { ...state, lives: state.lives - 1, hints: [...(state.hints ?? []), rank] };
}

export function giveUp(state: GameState): GameState {
  return state.status === "playing" ? { ...state, status: "gave-up" } : state;
}

/**
 * Share text: one square per rank (#1 gold, found blue, missed black), lives left and hints used.
 * `daily` is the daily number when the game was a daily ("Top Tens #12").
 */
export function shareText(state: GameState, puzzle: Puzzle, url: string, daily?: number): string {
  const squares = puzzle.answers
    .map((a) => (state.found.includes(a.rank) ? (a.rank === 1 ? "🟨" : "🟦") : "⬛"))
    .join("");
  const hearts = "♥".repeat(state.lives) + "♡".repeat(MAX_LIVES - state.lives);
  const hints = state.hints?.length ? ` · ${state.hints.length} hint${state.hints.length > 1 ? "s" : ""}` : "";
  const head = daily ? `Top Tens #${daily}: ${puzzle.title}` : `Top Tens: ${puzzle.title}`;
  return `${head}\n${state.found.length}/10 ${hearts}${hints}\n${squares}\n${url}`;
}
