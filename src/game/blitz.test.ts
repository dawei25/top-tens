import { describe, expect, it } from "vitest";
import {
  BLITZ_SECONDS,
  blitzAvailable,
  blitzGuess,
  blitzScore,
  blitzShareText,
  finishBlitz,
  isOver,
  missedTop,
  newBlitz,
  points,
  recordBlitz,
  startBlitz,
  timeLeft,
} from "./blitz";
import type { Saved } from "./storage";
import type { Entry, Puzzle } from "./types";

const e = (rank: number, name: string, n?: number, aliases: string[] = []): Entry => ({ rank, name, aliases, n });

const puzzle: Puzzle = {
  id: "islands",
  title: "Largest islands",
  prompt: "",
  blitz: true,
  source: { name: "", url: "", asOf: "" },
  answers: [e(1, "Greenland", 2_000_000), e(2, "New Guinea", 785_000), e(3, "Borneo", 743_000), e(4, "Madagascar", 587_000)],
  extras: [e(0, "Faroe Islands", 1_393), e(0, "France"), e(11, "Ellesmere Island", 196_000), e(0, "Mount Kilimanjaro")],
};

describe("points", () => {
  it("runs from 10 to 100 on both curves", () => {
    expect(points(2_000_000, 2_000_000)).toBe(100);
    expect(points(500_000, 2_000_000, "sqrt")).toBe(55);
    expect(points(500_000, 2_000_000, "linear")).toBe(33);
    expect(points(1, 2_000_000)).toBe(10);
    expect(points(0, 100)).toBe(10);
    expect(points(5, 0)).toBe(10);
  });
});

describe("blitz round", () => {
  const t0 = 1_000_000;
  it("the clock waits for the first keystroke and ends after the round", () => {
    let s = newBlitz(puzzle);
    expect(timeLeft(s, t0)).toBe(BLITZ_SECONDS * 1000);
    s = startBlitz(s, t0);
    expect(timeLeft(s, t0 + 30_000)).toBe((BLITZ_SECONDS - 30) * 1000);
    expect(isOver(s, t0 + BLITZ_SECONDS * 1000)).toBe(true);
    expect(blitzGuess(s, puzzle, "Borneo", undefined, undefined, t0 + BLITZ_SECONDS * 1000).result.kind).toBe("over");
  });

  it("scores ranked and unranked answers with a stat, typos at once, nothing else", () => {
    let s = startBlitz(newBlitz(puzzle), t0);
    const play = (text: string) => {
      const r = blitzGuess(s, puzzle, text, undefined, undefined, t0 + 1000);
      s = r.state;
      return r.result;
    };
    expect(play("Greenland")).toMatchObject({ kind: "scored", hit: { points: 100 }, corrected: false });
    expect(play("Madagascr")).toMatchObject({ kind: "scored", hit: { name: "Madagascar" }, corrected: true });
    expect(play("Faroe Islands")).toMatchObject({ kind: "scored", hit: { points: 12 } });
    expect(play("greenland")).toMatchObject({ kind: "duplicate" });
    expect(play("France")).toMatchObject({ kind: "none", junk: false });
    expect(play("asdf")).toMatchObject({ kind: "none" });
    expect(s.hits.map((h) => h.name)).toEqual(["Greenland", "Madagascar", "Faroe Islands"]);
    expect(blitzScore(s)).toBe(100 + points(587_000, 2_000_000) + 12);
    expect(missedTop(puzzle, s, 3).map((x) => x.name)).toEqual(["New Guinea", "Borneo", "Ellesmere Island"]);
    expect(blitzShareText(finishBlitz(s, t0 + 90_000), puzzle, "u")).toContain("3 answers in 90s");
  });
});

describe("availability and bests", () => {
  const saved: Saved = { games: {}, daily: {}, seenHelp: true };
  const schedule = [
    { n: 1, date: "2026-10-28", id: "old" },
    { n: 2, date: "2026-10-29", id: "islands" },
    { n: 3, date: "2026-10-30", id: "later" },
  ];
  it("blocks today's daily until it's finished, and future dailies", () => {
    expect(blitzAvailable(puzzle, schedule, "2026-10-29", saved)).toBe(false);
    const done: Saved = { ...saved, games: { islands: { puzzleId: "islands", found: [], lives: 0, log: [], status: "lost" } } };
    expect(blitzAvailable(puzzle, schedule, "2026-10-29", done)).toBe(true);
    expect(blitzAvailable({ id: "later", blitz: true }, schedule, "2026-10-29", saved)).toBe(false);
    expect(blitzAvailable({ id: "old", blitz: true }, schedule, "2026-10-29", saved)).toBe(true);
    expect(blitzAvailable({ id: "x" }, schedule, "2026-10-29", saved)).toBe(false);
  });
  it("keeps the best score per list", () => {
    const a = recordBlitz(saved, "islands", 300);
    expect(a.best).toBe(true);
    const b = recordBlitz(a.saved, "islands", 200);
    expect(b).toMatchObject({ best: false, previous: 300 });
  });
});
