export interface Entry {
  /** 1-based position in the source ranking; 0 for a real answer the source doesn't rank. */
  rank: number;
  name: string;
  aliases: string[];
  /** Display value from the source table, e.g. "1,441,719,852". */
  value?: string;
}

export interface Puzzle {
  id: string;
  /** e.g. "Most populous countries" */
  title: string;
  /** e.g. "Name the 10 most populous countries in the world" */
  prompt: string;
  /** Column the ranking is by, e.g. "Population" */
  metric?: string;
  source: { name: string; url: string; asOf: string };
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
