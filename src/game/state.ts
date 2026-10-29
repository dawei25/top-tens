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
}

export function newGame(puzzle: Puzzle): GameState {
  return { puzzleId: puzzle.id, found: [], lives: MAX_LIVES, log: [], status: "playing" };
}

export function costsLife(r: GuessResult): boolean {
  return r.kind === "wrong" || r.kind === "near";
}

export function applyGuess(
  state: GameState,
  puzzle: Puzzle,
  text: string,
  lex?: Lexicon,
): { state: GameState; result: GuessResult } {
  if (state.status !== "playing") return { state, result: { kind: "empty" } };
  const result = judgeGuess(text, puzzle, new Set(state.found), lex);
  if (result.kind === "empty" || result.kind === "junk") return { state, result };

  // Re-guessing an answer that already cost a life shouldn't cost another.
  if (costsLife(result) && result.kind === "near" && state.log.some((l) => l.result.kind === "near" && l.result.entry.rank === result.entry.rank)) {
    return { state, result: { kind: "duplicate", entry: result.entry } };
  }

  const found = result.kind === "correct" ? [...state.found, result.entry.rank] : state.found;
  const lives = costsLife(result) ? state.lives - 1 : state.lives;
  const status = found.length === puzzle.answers.length ? "won" : lives <= 0 ? "lost" : "playing";
  return { state: { ...state, found, lives, status, log: [...state.log, { text, result }] }, result };
}

export function giveUp(state: GameState): GameState {
  return state.status === "playing" ? { ...state, status: "gave-up" } : state;
}

/** Share text: one square per rank, plus lives used. */
export function shareText(state: GameState, puzzle: Puzzle, url: string): string {
  const squares = puzzle.answers.map((a) => (state.found.includes(a.rank) ? "🟩" : "⬛")).join("");
  const hearts = "♥".repeat(state.lives) + "♡".repeat(MAX_LIVES - state.lives);
  return `Top Tens: ${puzzle.title}\n${state.found.length}/10 ${hearts}\n${squares}\n${url}`;
}
