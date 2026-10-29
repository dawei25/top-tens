import { describe, expect, it } from "vitest";
import { applyGuess, newGame } from "./state";
import type { Puzzle } from "./types";

const puzzle: Puzzle = {
  id: "t",
  title: "T",
  prompt: "",
  source: { name: "", url: "", asOf: "" },
  answers: ["India", "China", "United States", "Indonesia", "Pakistan", "Nigeria", "Brazil", "Bangladesh", "Russia", "Ethiopia"].map(
    (name, i) => ({ rank: i + 1, name, aliases: [] }),
  ),
  extras: [{ rank: 11, name: "Mexico", aliases: [] }],
};

const play = (...guesses: string[]) =>
  guesses.reduce((s, g) => applyGuess(s, puzzle, g).state, newGame(puzzle));

describe("game state", () => {
  it("only wrong and near guesses cost lives", () => {
    const s = play("India", "Indai", "Packeestan", "Mexico", "Japan");
    expect(s.found).toEqual([1]);
    expect(s.lives).toBe(3);
  });

  it("does not charge twice for the same near miss", () => {
    expect(play("Mexico", "mexico").lives).toBe(4);
  });

  it("ends on five wrong guesses", () => {
    expect(play("Japan", "Canada", "Peru", "Kenya", "Oman").status).toBe("lost");
  });

  it("junk input costs nothing and isn't logged", () => {
    const s = play("asdf", "qwerty", "lkjh");
    expect(s.lives).toBe(5);
    expect(s.log).toHaveLength(0);
  });

  it("wins at 10/10", () => {
    expect(play(...puzzle.answers.map((a) => a.name)).status).toBe("won");
  });
});
