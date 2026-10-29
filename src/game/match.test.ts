import { describe, expect, it } from "vitest";
import { judgeGuess, normalize } from "./match";
import type { Entry, Puzzle } from "./types";

const e = (rank: number, name: string, aliases: string[] = []): Entry => ({ rank, name, aliases });

const puzzle: Puzzle = {
  id: "test",
  title: "Most populous countries",
  prompt: "Name the 10 most populous countries",
  source: { name: "Wikipedia", url: "", asOf: "2026-01-01" },
  answers: [
    e(1, "India"),
    e(2, "China", ["People's Republic of China", "PRC"]),
    e(3, "United States", ["USA", "US", "America", "United States of America"]),
    e(4, "Indonesia"),
    e(5, "Pakistan"),
    e(6, "Nigeria"),
    e(7, "Brazil"),
    e(8, "Bangladesh"),
    e(9, "Russia", ["Russian Federation"]),
    e(10, "Ethiopia"),
  ],
  extras: [e(11, "Mexico"), e(17, "Iran"), e(19, "Germany"), e(36, "Iraq"), e(37, "Niger")],
};

const judge = (g: string, found: number[] = []) => judgeGuess(g, puzzle, new Set(found));

describe("normalize", () => {
  it("strips case, accents, punctuation and leading articles", () => {
    expect(normalize("  The Côte d'Ivoire! ")).toBe("cote divoire");
    expect(normalize("U.S.A.")).toBe("usa");
    expect(normalize("Trinidad & Tobago")).toBe("trinidad and tobago");
  });
});

describe("judgeGuess", () => {
  it("accepts exact names and aliases", () => {
    expect(judge("india")).toMatchObject({ kind: "correct", corrected: false });
    expect(judge("USA")).toMatchObject({ kind: "correct", entry: { rank: 3 } });
    expect(judge("the united states of america")).toMatchObject({ kind: "correct", entry: { rank: 3 } });
  });

  it("autocorrects close misspellings", () => {
    expect(judge("Bangladesch")).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 8 } });
    expect(judge("Ethopia")).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 10 } });
    expect(judge("Indoneisa")).toMatchObject({ kind: "correct", entry: { rank: 4 } });
    expect(judge("Paskitsan")).toMatchObject({ kind: "correct", entry: { rank: 5 } });
  });

  it("does not let Nigeria and Niger collide", () => {
    expect(judge("Niger")).toMatchObject({ kind: "near", entry: { rank: 37 } });
    expect(judge("Nigeria")).toMatchObject({ kind: "correct", entry: { rank: 6 } });
  });

  it("asks for clarification when a typo is ambiguous", () => {
    const r = judge("Irak");
    expect(r.kind).toBe("typo");
  });

  it("flags duplicates without costing a life", () => {
    expect(judge("India", [1])).toMatchObject({ kind: "duplicate" });
    expect(judge("Indai", [1])).toMatchObject({ kind: "duplicate" });
  });

  it("reports ranks 11+ as near misses", () => {
    expect(judge("Mexico")).toMatchObject({ kind: "near", entry: { rank: 11 } });
    expect(judge("Germny")).toMatchObject({ kind: "near", corrected: true });
  });

  it("treats far-off misspellings as typos, not wrong", () => {
    expect(judge("Packeestan")).toMatchObject({ kind: "typo", suggestions: ["Pakistan"] });
  });

  it("never credits a different real answer (Listable accepts Indonesia for India)", () => {
    const withoutIndonesia = { ...puzzle, answers: puzzle.answers.filter((a) => a.rank !== 4) };
    expect(judgeGuess("Indonesia", withoutIndonesia, new Set()).kind).toBe("wrong");
    expect(judgeGuess("Iran", puzzle, new Set())).toMatchObject({ kind: "near", entry: { name: "Iran" } });
  });

  it("marks unrelated answers wrong", () => {
    expect(judge("Japan").kind).toBe("wrong");
    expect(judge("Elon Musk").kind).toBe("wrong");
    expect(judge("   ").kind).toBe("empty");
  });

  it("calls keyboard mash junk instead of wrong", () => {
    expect(judge("asdfgh").kind).toBe("junk");
    expect(judge("qwerty").kind).toBe("junk");
    expect(judge("jjjj").kind).toBe("junk");
  });
});
