import { describe, expect, it } from "vitest";
import { applyGuess, newGame, rankedDepth, shownValue } from "./state";
import type { Puzzle } from "./types";

const puzzle: Puzzle = {
  id: "t",
  title: "T",
  prompt: "",
  source: { name: "", url: "", asOf: "" },
  answers: ["India", "China", "United States", "Indonesia", "Pakistan", "Nigeria", "Brazil", "Bangladesh", "Russia", "Ethiopia"].map(
    (name, i) => ({ rank: i + 1, name, aliases: [] }),
  ),
  extras: ["Mexico", "Japan", "Philippines", "Egypt", "Vietnam"].map((name, i) => ({ rank: 11 + i, name, aliases: [] })),
};

const play = (...guesses: string[]) =>
  guesses.reduce((s, g) => applyGuess(s, puzzle, g).state, newGame(puzzle));

describe("game state", () => {
  it("only accepted non-top-10 answers cost lives", () => {
    const s = play("India", "Indai", "Packeestan", "Mexico", "Japan", "asdf");
    expect(s.found).toEqual([1, 5]);
    expect(s.lives).toBe(3); // Mexico and Japan are accepted answers outside the top 10
  });

  it("does not charge twice for the same near miss", () => {
    expect(play("Mexico", "mexico").lives).toBe(4);
  });

  it("ends on five wrong guesses", () => {
    expect(play("Mexico", "Japan", "Philippines", "Egypt", "Vietnam").status).toBe("lost");
  });

  it("unrecognized input costs nothing and isn't logged", () => {
    const s = play("asdf", "qwerty", "Canada", "Elon Musk");
    expect(s.lives).toBe(5);
    expect(s.log).toHaveLength(0);
  });

  it("wins at 10/10", () => {
    expect(play(...puzzle.answers.map((a) => a.name)).status).toBe("won");
  });
});

describe("shown values", () => {
  it("hides a value that only repeats the rank", () => {
    expect(shownValue({ rank: 19, value: "#19" })).toBeUndefined();
    expect(shownValue({ rank: 19, value: "8,849 m" })).toBe("8,849 m");
    expect(shownValue({ rank: 0, value: "12" })).toBe("12");
    expect(shownValue({ rank: 3 })).toBeUndefined();
  });
});

describe("rankedDepth", () => {
  const e = (rank: number) => ({ rank, name: `n${rank}`, aliases: [] });
  it("is the deepest rank the list carries, never under 10", () => {
    expect(rankedDepth({ answers: [e(1), e(10)], extras: [e(11), e(117), e(0)] })).toBe(117);
    expect(rankedDepth({ answers: [e(1), e(10)], extras: [e(0)] })).toBe(10);
  });
});
