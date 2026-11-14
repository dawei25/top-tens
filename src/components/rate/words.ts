import type { RatingReason } from "../../net/ratings";

/**
 * What the rating row and its note say, by what is rated: a list (a list game, a Blitz round) or a Fathom question
 * (owner, Nov 14: "add the same feedback system for fathom ... same mechanics and tables"). The reasons are stored by
 * the same codes either way (rate_list's set); only their words change where a list's would read oddly for one
 * question: "answers felt unfair" is "unclear", "wrong data" is "wrong answer".
 */
export type RatedKind = "list" | "question";

export interface RateWords {
  /** The row's question: "Good list?". */
  ask: string;
  /** The thumbs' names for a screen reader. */
  up: string;
  down: string;
  /** Each reason as the picker says it, and as the row repeats it once picked (short enough for a phone's row). */
  reasons: Record<RatingReason, string>;
  picked: Record<RatingReason, string>;
  /** The note box's hint and name. */
  placeholder: string;
  noteLabel: string;
}

const LIST_REASONS: Record<RatingReason, string> = {
  "too-hard": "too hard",
  "too-easy": "too easy",
  boring: "boring",
  unfair: "answers felt unfair",
  "wrong-data": "wrong data",
};
const QUESTION_REASONS: Record<RatingReason, string> = {
  "too-hard": "too hard",
  "too-easy": "too easy",
  boring: "boring",
  unfair: "unclear",
  "wrong-data": "wrong answer",
};

export const RATE_WORDS: Record<RatedKind, RateWords> = {
  list: {
    ask: "Good list?",
    up: "good list",
    down: "not a good list",
    reasons: LIST_REASONS,
    picked: { ...LIST_REASONS, unfair: "unfair" },
    placeholder: "what would make this list better?",
    noteLabel: "A note on this list",
  },
  question: {
    ask: "Good question?",
    up: "good question",
    down: "not a good question",
    reasons: QUESTION_REASONS,
    picked: QUESTION_REASONS,
    placeholder: "what would make this question better?",
    noteLabel: "A note on this question",
  },
};
