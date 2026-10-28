export interface Entry {
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
  /** Ranks 11+ from the same source. Guessing one costs a life but shows its rank. */
  extras: Entry[];
}

export type GuessResult =
  | { kind: "empty" }
  | { kind: "correct"; entry: Entry; corrected: boolean }
  | { kind: "duplicate"; entry: Entry }
  | { kind: "near"; entry: Entry; corrected: boolean }
  | { kind: "typo"; suggestions: string[] }
  | { kind: "wrong" };
