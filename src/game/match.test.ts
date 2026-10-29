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

  it("fills in a clear misspelling of one top-10 answer", () => {
    expect(judge("Packeestan")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Pakistan" } });
  });

  it("treats numbers as identity, not spelling", () => {
    const games: Puzzle = {
      ...puzzle,
      answers: [e(1, "Grand Theft Auto V", ["GTA V"]), e(2, "Mario Kart 8")],
      extras: [e(11, "Grand Theft Auto IV", ["GTA IV"]), e(12, "Grand Theft Auto: San Andreas")],
    };
    const g = (s: string) => judgeGuess(s, games, new Set());
    expect(g("gta5")).toMatchObject({ kind: "correct", entry: { rank: 1 } });
    expect(g("Grand Theft Auto 5")).toMatchObject({ kind: "correct", entry: { rank: 1 } });
    expect(g("gta 4")).toMatchObject({ kind: "near", entry: { rank: 11 } });
    expect(g("gta 6").kind).toBe("unknown");
    expect(g("mario kart 7").kind).toBe("unknown");
  });

  it("never credits a different real answer (Listable accepts Indonesia for India)", () => {
    const withoutIndonesia = { ...puzzle, answers: puzzle.answers.filter((a) => a.rank !== 4) };
    expect(judgeGuess("Indonesia", withoutIndonesia, new Set()).kind).toBe("unknown");
    expect(judgeGuess("Iran", puzzle, new Set())).toMatchObject({ kind: "near", entry: { name: "Iran" } });
  });

  it("lets anything that isn't an accepted answer through for free", () => {
    expect(judge("Japan")).toMatchObject({ kind: "unknown", junk: false });
    expect(judge("Elon Musk")).toMatchObject({ kind: "unknown", junk: false });
    expect(judge("asdfgh")).toMatchObject({ kind: "unknown", junk: true });
    expect(judge("qwerty")).toMatchObject({ kind: "unknown", junk: true });
    expect(judge("   ").kind).toBe("empty");
  });
});

describe("intent", () => {
  const islands: Puzzle = {
    id: "islands",
    title: "Largest islands",
    prompt: "",
    source: { name: "", url: "", asOf: "" },
    answers: [
      e(1, "Greenland"),
      e(2, "New Guinea"),
      e(3, "Borneo"),
      e(4, "Madagascar"),
      e(5, "Baffin Island", ["Baffin"]),
      e(6, "Sumatra"),
      e(7, "Honshu"),
      e(8, "Victoria Island"),
      e(9, "Great Britain", ["UK", "United Kingdom"]),
      e(10, "Ellesmere Island"),
    ],
    extras: [
      e(12, "South Island", ["New Zealand"]),
      e(14, "North Island", ["New Zealand"]),
      e(0, "Faroe Islands"),
      e(30, "Tokyo Haneda Airport"),
    ],
  };
  const j = (s: string, found: number[] = []) => judgeGuess(s, islands, new Set(found));

  it("counts curated same-thing names", () => {
    expect(j("UK")).toMatchObject({ kind: "correct", entry: { name: "Great Britain" } });
    expect(j("united kingdom")).toMatchObject({ kind: "correct", entry: { name: "Great Britain" } });
  });

  it("offers every entry behind a shared name, alphabetically", () => {
    expect(j("New Zealand")).toEqual({ kind: "typo", suggestions: ["North Island", "South Island"] });
  });

  it("accepts unranked real answers", () => {
    expect(j("Faroe Islands")).toMatchObject({ kind: "near", entry: { rank: 0 } });
  });

  it("matches a distinctive word from a longer name", () => {
    expect(j("Haneda")).toMatchObject({ kind: "near", corrected: false, entry: { name: "Tokyo Haneda Airport" } });
    expect(j("Ellesmere")).toMatchObject({ kind: "correct", corrected: false, entry: { rank: 10 } });
    expect(j("island").kind).toBe("unknown");
  });
});
