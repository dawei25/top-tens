import { describe, expect, it } from "vitest";
import {
  BLITZ_SECONDS,
  blitzAvailable,
  blitzGuess,
  blitzScore,
  blitzShareText,
  finishBlitz,
  freshBlitz,
  isOver,
  missedTop,
  newBlitz,
  points,
  recordBlitz,
  recordDailyBlitz,
  blitzHistory,
  MAX_BLITZ_RUNS,
  resumeBlitz,
  saveLiveBlitz,
  startBlitz,
  timeLeft,
} from "./blitz";
import { blitzOfTheDay } from "./daily";
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
  it("blend: #1 is 100, the top 10 gets a bonus, deep answers still score", () => {
    expect(points(2_000_000, 2_000_000, 1, true)).toBe(100);
    // Mountains-like flat list: #10 vs #11 differ by the bonus plus a little rank decay.
    expect(points(8_091, 8_849, 10, true)).toBe(80);
    expect(points(8_080, 8_849, 11, false)).toBe(68);
    expect(points(6_000, 8_849, 100, false)).toBeGreaterThanOrEqual(43);
    expect(points(1, 2_000_000, 500, false)).toBe(10);
  });
  it("value-only formulas stay available for comparison", () => {
    expect(points(500_000, 2_000_000, 1, false, "sqrt")).toBe(55);
    expect(points(500_000, 2_000_000, 1, false, "linear")).toBe(33);
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
    expect(play("Faroe Islands")).toMatchObject({ kind: "scored", hit: { name: "Faroe Islands" } });
    expect(play("greenland")).toMatchObject({ kind: "duplicate" });
    expect(play("France")).toMatchObject({ kind: "none", junk: false });
    expect(play("asdf")).toMatchObject({ kind: "none" });
    expect(s.hits.map((h) => h.name)).toEqual(["Greenland", "Madagascar", "Faroe Islands"]);
    expect(blitzScore(s)).toBe(s.hits.reduce((t, h) => t + h.points, 0));
    expect(s.hits[1].points).toBe(points(587_000, 2_000_000, 4, true));
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
  const round = (startedAt: number, pts: number[]) => ({
    puzzleId: "islands",
    startedAt,
    endedAt: startedAt + 90_000,
    hits: pts.map((p, i) => ({ name: `x${i}`, rank: 0, n: 1, points: p })),
  });
  it("keeps the best score and a capped history, newest first", () => {
    const a = recordBlitz(saved, "islands", round(1, [100, 200]));
    expect(a.best).toBe(true);
    const b = recordBlitz(a.saved, "islands", round(2, [50]));
    expect(b).toMatchObject({ best: false, previous: 300 });
    expect(blitzHistory(b.saved, "islands").map((r) => r.score)).toEqual([50, 300]);
    expect(recordBlitz(b.saved, "islands", round(2, [50])).saved.blitzRuns?.islands).toHaveLength(2);
    let s = b.saved;
    for (let i = 10; i < 40; i++) s = recordBlitz(s, "islands", round(i, [1])).saved;
    expect(blitzHistory(s, "islands")).toHaveLength(MAX_BLITZ_RUNS);
  });
  it("a round left mid-way resumes, or finishes if its time ran out", () => {
    const live = { puzzleId: "islands", startedAt: 1_000, hits: [] };
    const s = saveLiveBlitz(saved, live);
    expect(resumeBlitz(s, "islands", 30_000)).toMatchObject({ over: false });
    expect(resumeBlitz(s, "islands", 200_000)).toMatchObject({ over: true, state: { endedAt: 91_000 } });
    expect(recordBlitz(s, "islands", { ...live, endedAt: 91_000 }).saved.blitzLive?.islands).toBeUndefined();
  });
});

describe("today's blitz", () => {
  const lists = ["a", "b", "c", "d", "e"].map((id) => ({ id, blitz: true }));
  const sched = [
    { n: 1, date: "2026-10-28", id: "a" },
    { n: 2, date: "2026-10-29", id: "b" },
    { n: 3, date: "2026-10-30", id: "c" },
  ];
  it("is never that day's daily or a later daily, is stable for the day, and honours a hand pick", () => {
    const pick = blitzOfTheDay(sched, lists, "2026-10-29");
    expect(["a", "d", "e"]).toContain(pick);
    expect(blitzOfTheDay(sched, lists, "2026-10-29")).toBe(pick);
    expect(blitzOfTheDay([{ ...sched[1], blitz: "e" }], lists, "2026-10-29")).toBe("e");
    expect(blitzOfTheDay(sched, [{ id: "b", blitz: true }], "2026-10-29")).toBeUndefined();
  });
  it("only the first finished round of the day counts", () => {
    const saved: Saved = { games: {}, daily: {}, seenHelp: true };
    const st = (score: number) => ({ puzzleId: "a", startedAt: 1, endedAt: 2, hits: [{ name: "x", rank: 1, n: 1, points: score }] });
    const first = recordDailyBlitz(saved, "2026-10-29", st(300));
    expect(first.counted).toBe(true);
    const again = recordDailyBlitz(first.saved, "2026-10-29", st(900));
    expect(again.counted).toBe(false);
    expect(again.saved.blitzDaily?.["2026-10-29"]).toMatchObject({ score: 300, answers: 1 });
  });
});

describe("fresh Blitz start", () => {
  it("ends a left-behind round into the history and clears it", () => {
    const empty: Saved = { games: {}, daily: {}, seenHelp: true };
    const t0 = 1_000_000;
    const live = saveLiveBlitz(empty, startBlitz(newBlitz(puzzle), t0));
    expect(freshBlitz(empty, puzzle.id)).toBe(empty);
    const fresh = freshBlitz(live, puzzle.id, t0 + 5_000);
    expect(fresh.blitzLive?.[puzzle.id]).toBeUndefined();
    expect(blitzHistory(fresh, puzzle.id)).toHaveLength(1);
  });
});
