import { blitzShareText, type BlitzState } from "../game/blitz";
import { MAX_LIVES, shareText, type GameState } from "../game/state";
import type { Puzzle } from "../game/types";

/**
 * Share text that keeps its lines in a Reddit comment: Markdown (and old Reddit) joins lines that don't end in two
 * spaces into one run-on line. Every line but the last (the link) ends in two spaces.
 */
export function pasteable(text: string): string {
  const lines = text.split("\n");
  return lines.map((l, i) => (i < lines.length - 1 ? `${l.trimEnd()}  ` : l)).join("\n");
}

/** "3 lives left", "1 life left", "0 lives left". */
export const livesLeft = (n: number) => `${n} ${n === 1 ? "life" : "lives"} left`;

/**
 * A list game's share text (src/game/state.ts shareText), with the lives said in words: five hollow hearts for none
 * left read as nothing. "TENtacle #12: Busiest airports / 7/10 · 2 lives left · 1 clue / 🟨🟦⬛... / link".
 */
export function listShare(state: GameState, puzzle: Puzzle, url: string, daily?: number): string {
  const hearts = "♥".repeat(state.lives) + "♡".repeat(MAX_LIVES - state.lives);
  return pasteable(shareText(state, puzzle, url, daily).replace(` ${hearts}`, ` · ${livesLeft(state.lives)}`));
}

/** A Blitz round's share text (Blitz is free play only: no daily number). */
export const blitzShare = (state: BlitzState, puzzle: Puzzle, url: string) => pasteable(blitzShareText(state, puzzle, url));
