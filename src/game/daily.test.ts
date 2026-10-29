import { describe, expect, it } from "vitest";
import { archive, dailyHoldouts, formatCountdown, msUntilNextDaily, streak, todayEntry, type DailyEntry } from "./daily";
import { applyHint, canHint, hintLetter, newGame, shareText } from "./state";
import type { Saved } from "./storage";
import type { Puzzle } from "./types";

const schedule: DailyEntry[] = [
  { n: 1, date: "2026-10-20", id: "a" },
  { n: 2, date: "2026-10-21", id: "b" },
  { n: 3, date: "2026-10-22", id: "c" },
];
const saved = (days: string[]): Saved => ({ games: {}, seenHelp: true, daily: Object.fromEntries(days.map((d) => [d, "x"])) });

describe("daily schedule", () => {
  it("today's entry, with the latest past entry standing in when the schedule runs out", () => {
    expect(todayEntry(schedule, "2026-10-21")?.id).toBe("b");
    expect(todayEntry(schedule, "2026-10-25")?.id).toBe("c");
    expect(todayEntry(schedule, "2026-10-19")).toBeUndefined();
  });
  it("archive lists past and today, newest first, never the future", () => {
    expect(archive(schedule, "2026-10-21").map((e) => e.n)).toEqual([2, 1]);
  });
  it("countdown to local midnight", () => {
    expect(msUntilNextDaily(new Date(2026, 9, 29, 23, 0, 0))).toBe(3_600_000);
    expect(formatCountdown(3_723_000)).toBe("01:02:03");
  });
});

describe("streaks", () => {
  it("counts consecutive days ending today", () => {
    expect(streak(saved(["2026-10-27", "2026-10-28", "2026-10-29"]), "2026-10-29")).toMatchObject({ current: 3, best: 3 });
  });
  it("stays alive until today's daily is played", () => {
    expect(streak(saved(["2026-10-27", "2026-10-28"]), "2026-10-29").current).toBe(2);
  });
  it("breaks after a missed day but remembers the best run", () => {
    expect(streak(saved(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-28"]), "2026-10-29")).toMatchObject({ current: 1, best: 3, played: 4 });
    expect(streak(saved(["2026-10-25"]), "2026-10-29").current).toBe(0);
  });
  it("handles month boundaries", () => {
    expect(streak(saved(["2026-10-31", "2026-11-01"]), "2026-11-01").current).toBe(2);
  });
});

describe("hints", () => {
  const puzzle = { id: "t", title: "T", prompt: "", source: { name: "", url: "", asOf: "" }, answers: [], extras: [] } as unknown as Puzzle;
  it("first letter past a leading article", () => {
    expect(hintLetter("The Witcher 3: Wild Hunt")).toBe("W");
    expect(hintLetter("Mount Everest")).toBe("M");
    expect(hintLetter("2001: A Space Odyssey")).toBe("2");
  });
  it("costs a life, once per slot, never the last life", () => {
    let s = applyHint(newGame(puzzle), 3);
    expect(s.lives).toBe(4);
    expect(applyHint(s, 3)).toBe(s);
    s = { ...s, lives: 1 };
    expect(canHint(s, 5)).toBe(false);
  });
  it("share text names the daily and counts hints", () => {
    const s = applyHint(newGame(puzzle), 2);
    expect(shareText(s, puzzle, "u", 12)).toContain("TENtacle #12: T");
    expect(shareText(s, puzzle, "u", 12)).toContain("1 hint");
  });
});

describe("random rolls", () => {
  it("never repeats the last few picks and still covers the whole pool", async () => {
    const { pickRandom } = await import("./puzzles");
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const picks = Array.from({ length: 200 }, () => pickRandom(ids, "test")!);
    for (let i = 1; i < picks.length; i++) expect(picks.slice(Math.max(0, i - 5), i)).not.toContain(picks[i]);
    expect(new Set(picks).size).toBe(10);
    expect(pickRandom(["only"], "solo")).toBe("only");
    expect(pickRandom(["only"], "solo")).toBe("only");
  });
});

describe("random roll holdouts", () => {
  it("holds back today's daily and future ones, and the stand-in once the schedule runs out", () => {
    expect([...dailyHoldouts(schedule, "2026-10-21")].sort()).toEqual(["b", "c"]);
    expect([...dailyHoldouts(schedule, "2026-11-05")]).toEqual(["c"]);
  });
});
