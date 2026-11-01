import { describe, expect, it } from "vitest";
import { blitzPrompt, NO_LIFE_LOST, notOnList } from "./copy";

const NBSP = String.fromCharCode(160);
const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ rank: i + 1, name: `e${i}`, aliases: [] }));
/** Ordinary spaces in place of the non-breaking ones, to read the copy. */
const plain = (s: string) => s.split(NBSP).join(" ");

describe("miss copy", () => {
  it("says how many of what are on the list when the puzzle names its noun", () => {
    expect(plain(notOnList({ noun: "films", answers: entries(10), extras: entries(227) }))).toBe("Not one of the 237 films here.");
    expect(plain(notOnList({ noun: "YouTube channels", answers: entries(10), extras: entries(3645) }))).toBe(
      "Not one of the 3,655 YouTube channels here.",
    );
  });
  it("falls back without a noun", () => {
    expect(notOnList({ answers: entries(10), extras: entries(5) })).toBe("Not on this list.");
  });
  it("keeps the noun's last word with its 'here.', and 'No life lost.' in one piece", () => {
    expect(notOnList({ noun: "NBA players", answers: entries(10), extras: [] })).toContain(`players${NBSP}here.`);
    expect(NO_LIFE_LOST).toBe(["No", "life", "lost."].join(NBSP));
  });
});

describe("Blitz prompt", () => {
  it("drops the top-10 cap from the list's prompt", () => {
    expect(blitzPrompt("Name the 10 most populous countries in the world")).toBe("Name the most populous countries in the world");
    expect(blitzPrompt("Something else")).toBe("Something else");
  });
});
