export interface Fact {
  /** One sentence, at most 120 characters. */
  text: string;
  /** URL of the Wikipedia article that supports it. */
  source: string;
}

export interface Entry {
  /** 1-based position in the source ranking; 0 for a real answer the source doesn't rank. */
  rank: number;
  name: string;
  aliases: string[];
  /** Display value from the source table, e.g. "1,441,719,852". */
  value?: string;
  /** Wikipedia article title for this entry (top 10 only). */
  article?: string;
  /** One short, sourced fun fact, shown on hover or tap once the row is revealed (top 10 only). */
  fact?: Fact;
}

export interface Puzzle {
  id: string;
  /** e.g. "Most populous countries" */
  title: string;
  /** e.g. "Name the 10 most populous countries in the world" */
  prompt: string;
  /** Column the ranking is by, e.g. "Population" */
  metric?: string;
  /**
   * asOf: the day the list was read from the source. dataAsOf: when the source says its numbers are from
   * ("March 2026", "2025"), if it says.
   */
  source: { name: string; url: string; asOf: string; dataAsOf?: string };
  /** Ranks 1-10, in order. */
  answers: Entry[];
  /**
   * Every other accepted answer: ranks 11+ from the source, plus unranked real answers (rank 0).
   * Guessing one costs a life. Anything outside answers + extras is free.
   */
  extras: Entry[];
}

export type GuessResult =
  | { kind: "empty" }
  | { kind: "correct"; entry: Entry; corrected: boolean }
  | { kind: "duplicate"; entry: Entry }
  | { kind: "near"; entry: Entry; corrected: boolean }
  | { kind: "typo"; suggestions: string[] }
  /** Not an accepted answer for this list. Free; `junk` picks the message. */
  | { kind: "unknown"; junk: boolean };
