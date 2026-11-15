// What the rating row says, for a list and for a Fathom question (owner, Nov 14: "add the same feedback system for
// fathom ... same mechanics and tables"): the same reason codes stored either way, plain words for a question.
import { describe, expect, it } from "vitest";
import { RATING_REASONS } from "../../net/ratings";
import { RATE_WORDS } from "./words";

describe("the rating row's words", () => {
  it("names a list's reasons as it always has", () => {
    const w = RATE_WORDS.list;
    expect([w.ask, w.up, w.down]).toEqual(["Good list?", "good list", "not a good list"]);
    expect(RATING_REASONS.map((r) => w.reasons[r])).toEqual(["too hard", "too easy", "boring", "answers felt unfair", "wrong data"]);
    expect(w.picked.unfair).toBe("unfair");
  });

  it("asks of a question in plain words, the stored codes unchanged", () => {
    const w = RATE_WORDS.question;
    expect([w.ask, w.up, w.down]).toEqual(["Good question?", "good question", "not a good question"]);
    // Every code rate_list takes has words, and only those.
    expect(Object.keys(w.reasons).sort()).toEqual([...RATING_REASONS].sort());
    expect(Object.keys(w.picked).sort()).toEqual([...RATING_REASONS].sort());
    expect(RATING_REASONS.map((r) => w.reasons[r])).toEqual(["too hard", "too easy", "boring", "unclear", "wrong answer"]);
    // Nothing of a list's ("answers felt unfair", "wrong data") on a single question.
    for (const text of [...Object.values(w.reasons), w.placeholder, w.noteLabel]) expect(text).not.toMatch(/\b(list|data|answers felt)\b/);
    expect(w.placeholder).toBe("what would make this question better?");
  });
});
