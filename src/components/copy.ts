import type { Puzzle } from "../game/types";

/** A non-breaking space: the words on either side wrap as one. */
const NBSP = String.fromCharCode(160);

/**
 * A plain miss (not junk, not vague, not an answer without a figure): "Not one of the 237 films here." when the puzzle
 * names its noun, otherwise "Not on this list." Short enough for one line of the control card on most lists; a long
 * noun wraps with its "here." rather than leaving it alone on the second line.
 */
export function notOnList(puzzle: Pick<Puzzle, "noun" | "answers" | "extras">): string {
  if (!puzzle.noun) return "Not on this list.";
  const count = puzzle.answers.length + puzzle.extras.length;
  return `Not one of the ${count.toLocaleString("en-US")} ${puzzle.noun}${NBSP}here.`;
}

/** The clue key on an empty row: its tooltip and accessible label. */
export const CLUE_LABEL = "Clue: first letter, costs a life";

/** What the days-in-a-row count means (Home's record and a daily's results). */
export const STREAK_NOTE = "Days in a row you've finished Today's list.";

/** "No life lost.", wrapping as one piece: onto its own line when the sentence before it fills the first. */
export const NO_LIFE_LOST = ["No", "life", "lost."].join(NBSP);

/** "So close.", never split across two lines. */
export const SO_CLOSE = ["So", "close."].join(NBSP);

/**
 * The guess box's hint and the misspelling confirm. Device-neutral: a phone's key says Send or Go, not Enter, so the
 * copy names the guess, not the key.
 */
export const GUESS_HINT = "type a name and guess. typos are free.";
/** The same hint where it shares its line with a key (Roll again, before a rolled list's first guess). */
export const GUESS_HINT_SHORT = "typos are free.";
export const confirmGuess = (name: string) => `Did you mean ${name}? Guess again to confirm.`;

/**
 * The list's prompt on the Blitz title card, where the goal is as many as you can:
 * "Name the 10 tallest buildings in the world" -> "Name the tallest buildings in the world".
 */
export function blitzPrompt(prompt: string): string {
  return prompt.replace(/^Name the 10 /, "Name the ");
}
