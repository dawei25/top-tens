import { describe, expect, it } from "vitest";
import { recordListRun } from "./history";
import {
  applyGuess,
  applyHint,
  canHint,
  hintCount,
  hintLetter,
  hintPrefix,
  newGame,
  rankedDepth,
  shareText,
  shownValue,
  type GameState,
} from "./state";
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

describe("clues", () => {
  // Rank 1..10: an article to skip, spaces, a hyphen, digits, an apostrophe, an accent.
  const names = ["The Witcher 3: Wild Hunt", "Los Angeles", "T-Mobile", "K2", "Mexico City", "2001: A Space Odyssey", "Xi'an", "São Paulo", "A Tribe Called Quest", "Shanghai"];
  const board: Puzzle = { ...puzzle, answers: names.map((name, i) => ({ rank: i + 1, name, aliases: [] })) };
  const clue = (s: GameState, ...ranks: number[]) => ranks.reduce((t, r) => applyHint(t, r), s);
  /** What the slot shows: the letters bought so far. */
  const shown = (s: GameState, rank: number) => hintPrefix(names[rank - 1], hintCount(s, rank));

  it("the first letter or digit, past a leading article", () => {
    expect(hintLetter("The Witcher 3: Wild Hunt")).toBe("W");
    expect(hintLetter("Mount Everest")).toBe("M");
    expect(hintLetter("2001: A Space Odyssey")).toBe("2");
    expect(hintPrefix("A Tribe Called Quest", 3)).toBe("TRI");
    expect(hintPrefix("The Witcher 3: Wild Hunt", 2)).toBe("WI");
    expect(hintPrefix("Shanghai", 0)).toBe("");
  });

  it("spaces and punctuation between letters show as they come; digits count as letters", () => {
    expect(hintPrefix("Los Angeles", 3)).toBe("LOS");
    expect(hintPrefix("Los Angeles", 4)).toBe("LOS A");
    expect(hintPrefix("T-Mobile", 3)).toBe("T-MO");
    expect(hintPrefix("Xi'an", 3)).toBe("XI'A");
    expect(hintPrefix("J. K. Rowling", 4)).toBe("J. K. RO");
    expect(hintPrefix("2001: A Space Odyssey", 5)).toBe("2001: A");
    expect(hintPrefix("São Paulo", 2)).toBe("SÃ");
  });

  it("two and three clues on one answer show the second and third letters, a life each", () => {
    let s = clue(newGame(board), 10);
    expect([s.lives, shown(s, 10)]).toEqual([4, "S"]);
    s = clue(s, 10);
    expect([s.lives, shown(s, 10)]).toEqual([3, "SH"]);
    s = clue(s, 10);
    expect([s.lives, shown(s, 10)]).toEqual([2, "SHA"]);
    // Stored by repeating the rank: one entry per letter.
    expect(s.hints).toEqual([10, 10, 10]);
    expect(hintCount(s, 2)).toBe(0);
  });

  it("never on the last life, a found answer or a finished game", () => {
    const s = clue(newGame(board), 10, 10, 10, 10);
    expect([s.lives, shown(s, 10)]).toEqual([1, "SHAN"]);
    expect(canHint(s, 10)).toBe(false);
    expect(canHint(s, 2)).toBe(false);
    expect(applyHint(s, 2)).toBe(s);
    const found = applyGuess(newGame(board), board, "Los Angeles").state;
    expect(canHint(found, 2)).toBe(false);
    expect(canHint({ ...newGame(board), status: "gave-up" }, 2)).toBe(false);
  });

  it("matching is unchanged by clues", () => {
    const s = clue(newGame(board), 2, 2);
    expect(applyGuess(s, board, "los").result.kind).toBe(applyGuess(newGame(board), board, "los").result.kind);
    expect(applyGuess(s, board, "Los Angeles").state.found).toEqual([2]);
  });

  it("old saves: a rank hinted once is still its first letter, and can now take the next", () => {
    const old: GameState = { puzzleId: "t", found: [], lives: 4, log: [], status: "playing", hints: [3, 7] };
    expect([hintCount(old, 3), shown(old, 3), shown(old, 7)]).toEqual([1, "T", "X"]);
    expect(canHint(old, 3)).toBe(true);
    expect(shown(clue(old, 3), 3)).toBe("T-M");
    // From before clues existed: nothing bought.
    expect(hintCount({ puzzleId: "t", found: [], lives: 5, log: [], status: "playing" }, 3)).toBe(0);
  });

  it("results, history and share text count every letter bought", () => {
    const one = clue(newGame(board), 2);
    expect(shareText(one, board, "u", 12)).toContain("TENtacle #12: T");
    expect(shareText(one, board, "u")).toContain("· 1 clue\n");
    const s = clue(newGame(board), 2, 2, 7);
    expect(shareText(s, board, "u")).toContain("· 3 clues");
    expect(shareText(s, board, "u")).toContain("♥♥♡♡♡");
    const done = { ...s, status: "gave-up" as const, finishedAt: 2, startedAt: 1 };
    expect(recordListRun({ games: {}, daily: {}, seenHelp: true }, done).listRuns?.[0].hints).toBe(3);
  });
});

describe("rankedDepth", () => {
  const e = (rank: number) => ({ rank, name: `n${rank}`, aliases: [] });
  it("is the deepest rank the list carries, never under 10", () => {
    expect(rankedDepth({ answers: [e(1), e(10)], extras: [e(11), e(117), e(0)] })).toBe(117);
    expect(rankedDepth({ answers: [e(1), e(10)], extras: [e(0)] })).toBe(10);
  });
});
