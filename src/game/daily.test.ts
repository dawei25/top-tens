import { describe, expect, it } from "vitest";
import {
  archive,
  blitzHold,
  blitzHoldouts,
  blitzOfTheDay,
  dailyGame,
  dailyHoldouts,
  formatCountdown,
  lockDaily,
  msUntilNextDaily,
  streak,
  todayEntry,
  type DailyEntry,
} from "./daily";
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

describe("one try per daily", () => {
  const played = (id: string, found: number[], status: "playing" | "lost" = "lost") => ({
    puzzleId: id, found, lives: 0, log: [], status,
  });
  it("the first finished game locks the date, even after a roll replays the list", () => {
    const empty = saved([]);
    const entry = schedule[0];
    expect(lockDaily(empty, entry.date, played("a", [1], "playing"))).toBe(empty);
    const locked = lockDaily(empty, entry.date, played("a", [1, 2]));
    expect(lockDaily(locked, entry.date, played("a", [1, 2, 3])).dailyGames?.[entry.date].found).toEqual([1, 2]);
    // A roll of the same list replaces the list's own save, not the daily's.
    const rolled: Saved = { ...locked, games: { a: played("a", [], "playing") } };
    expect(dailyGame(rolled, entry)?.found).toEqual([1, 2]);
  });
  it("older saves fall back to the list's game", () => {
    expect(dailyGame({ ...saved([]), games: { b: played("b", [4]) } }, schedule[1])?.found).toEqual([4]);
    expect(dailyGame(saved([]), schedule[1])).toBeUndefined();
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
  it("share text names the daily and counts clues", () => {
    const s = applyHint(newGame(puzzle), 2);
    expect(shareText(s, puzzle, "u", 12)).toContain("TENtacle #12: T");
    expect(shareText(s, puzzle, "u", 12)).toContain("1 clue");
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

describe("Today's Blitz", () => {
  const lists = ["a", "b", "c", "d", "e", "g", "h", "i", "j", "k"].map((id) => ({ id, blitz: true })).concat([{ id: "f" }]);
  const days: DailyEntry[] = [
    { n: 1, date: "2026-11-02", id: "h" },
    { n: 2, date: "2026-11-03", id: "a" },
    { n: 3, date: "2026-11-04", id: "b", blitz: "c" },
    { n: 4, date: "2026-11-05", id: "d" },
    { n: 5, date: "2026-11-06", id: "e", blitz: "g" },
    { n: 6, date: "2026-11-07", id: "f" },
  ];
  it("keeps a day's explicit pick", () => {
    expect(blitzOfTheDay(days, lists, "2026-11-04")).toBe("c");
    expect(blitzOfTheDay(days, lists, "2026-11-06")).toBe("g");
  });
  it("a day without its own pick gets another topic, never that day's list or a later daily", () => {
    for (const date of ["2026-11-05", "2026-11-07", "2026-11-09"]) {
      const id = blitzOfTheDay(days, lists, date);
      expect(id).toBeDefined();
      expect(["d", "e", "f"]).not.toContain(id);
      expect(lists.find((l) => l.id === id)?.blitz).toBe(true);
    }
  });
  it("older days keep the date-seeded pick, never that day's daily or a later one", () => {
    // What the pick gave for these dates before the switch existed.
    expect(blitzOfTheDay(days, lists, "2026-11-02")).toBe("g");
    expect(blitzOfTheDay(days, lists, "2026-11-03")).toBe("i");
  });
});

describe("Blitz spoiler holds", () => {
  const lists = [{ id: "a", blitz: true }, { id: "b", blitz: true }, { id: "c", blitz: true }];
  const days: DailyEntry[] = [
    { n: 1, date: "2026-11-04", id: "a" },
    { n: 2, date: "2026-11-05", id: "b" },
  ];
  const done = (id: string) => ({ puzzleId: id, found: [1], lives: 0, log: [], status: "lost" as const });
  it("a date's Blitz on its own unfinished list holds back the rest until that list is done", () => {
    const fresh = saved([]);
    expect(blitzHold(days, "2026-11-05", "b", fresh)?.n).toBe(2);
    expect(blitzHold(days, "2026-11-05", "b", { ...fresh, dailyGames: { "2026-11-05": done("b") } })).toBeUndefined();
    // A Blitz on another list spoils nothing of that date's.
    expect(blitzHold(days, "2026-11-04", "c", fresh)).toBeUndefined();
    // A day past the end of the schedule follows its stand-in.
    expect(blitzHold(days, "2026-11-07", "b", fresh)?.n).toBe(2);
  });
  it("free Blitz never offers today's daily, a future one, or Today's Blitz before it's played", () => {
    const fresh = saved([]);
    // 2026-11-04's Blitz is another list (c, the only one left).
    expect([...blitzHoldouts(days, lists, fresh, "2026-11-04")].sort()).toEqual(["a", "b", "c"]);
    const played: Saved = { ...fresh, blitzDaily: { "2026-11-04": { id: "c", score: 10, answers: 1 } } };
    expect([...blitzHoldouts(days, lists, played, "2026-11-04")].sort()).toEqual(["a", "b"]);
    // Today's list and Today's Blitz (another topic) are both held back.
    const todays = blitzOfTheDay(days, lists, "2026-11-05")!;
    expect(todays).not.toBe("b");
    expect([...blitzHoldouts(days, lists, fresh, "2026-11-05")].sort()).toEqual(["b", todays].sort());
  });
});
