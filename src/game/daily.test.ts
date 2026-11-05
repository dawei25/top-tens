import { describe, expect, it } from "vitest";
import {
  archive,
  blitzHold,
  blitzHoldouts,
  blitzOfTheDay,
  dailyGame,
  dailyHoldouts,
  formatCountdown,
  heldDebuts,
  lockDaily,
  lockLegacyDailies,
  msUntilNextDaily,
  rollHoldouts,
  streak,
  todayEntry,
  type DailyEntry,
} from "./daily";
import type { Saved } from "./storage";

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
  it("free Blitz never offers today's daily, a future one, or Today's Blitz", () => {
    const fresh = saved([]);
    // 2026-11-04's Blitz is another list (c, the only one left), held back played or not.
    expect([...blitzHoldouts(days, lists, fresh, "2026-11-04")].sort()).toEqual(["a", "b", "c"]);
    const played: Saved = { ...fresh, blitzDaily: { "2026-11-04": { id: "c", score: 10, answers: 1 } } };
    expect([...blitzHoldouts(days, lists, played, "2026-11-04")].sort()).toEqual(["a", "b", "c"]);
    // Today's list and Today's Blitz (another topic) are both held back.
    const todays = blitzOfTheDay(days, lists, "2026-11-05")!;
    expect(todays).not.toBe("b");
    expect([...blitzHoldouts(days, lists, fresh, "2026-11-05")].sort()).toEqual(["b", todays].sort());
  });
  it("a random roll never lands on today's list or Blitz, played or not, or on a future day's", () => {
    const sched: DailyEntry[] = [
      { n: 1, date: "2026-11-03", id: "a", blitz: "m" },
      { n: 2, date: "2026-11-04", id: "b", blitz: "n" },
    ];
    const all = [...lists, { id: "m", blitz: true }, { id: "n", blitz: true }, { id: "z", blitz: true }];
    const fresh = saved([]);
    // Nov 3: today's list a, today's Blitz m (unplayed), and Nov 4's list b and Blitz n are all held back.
    expect([...rollHoldouts(sched, all, fresh, "2026-11-03")].sort()).toEqual(["a", "b", "m", "n"]);
    // Played or not, today's pair stays out of random play for the day; the next day it's back.
    const played: Saved = { ...fresh, blitzDaily: { "2026-11-03": { id: "m", score: 5, answers: 3 } } };
    expect([...rollHoldouts(sched, all, played, "2026-11-03")].sort()).toEqual(["a", "b", "m", "n"]);
    expect([...rollHoldouts(sched, all, played, "2026-11-04")].sort()).toEqual(["b", "n"]);
    // Future Blitz topics are held even from the plain daily holdouts.
    expect(dailyHoldouts(sched, "2026-11-03").has("n")).toBe(true);
  });
});

describe("new lists debut as dailies", () => {
  // "new" debuts as Today's list on Nov 6, "fresh" as Today's Blitz on Nov 7; "later" has no day yet.
  const sched: DailyEntry[] = [
    { n: 1, date: "2026-11-05", id: "a", blitz: "b" },
    { n: 2, date: "2026-11-06", id: "new", blitz: "c" },
    { n: 3, date: "2026-11-07", id: "d", blitz: "fresh" },
    { n: 4, date: "2026-11-08", id: "x", blitz: "y" },
  ];
  const lists = [
    ...["a", "b", "c", "d", "old", "x", "y"].map((id) => ({ id, blitz: true })),
    { id: "new", blitz: true, debut: true },
    { id: "fresh", blitz: true, debut: true },
    { id: "later", blitz: true, debut: true },
  ];
  const fresh = saved([]);
  it("holds a new list out of random play, list and Blitz, before its day and on it", () => {
    for (const day of ["2026-11-01", "2026-11-05", "2026-11-06"]) {
      expect(heldDebuts(sched, lists, day).has("new"), day).toBe(true);
      expect(rollHoldouts(sched, lists, fresh, day).has("new"), day).toBe(true);
      expect(blitzHoldouts(sched, lists, fresh, day).has("new"), day).toBe(true);
    }
  });
  it("releases it the day after its first day as Today's list or Today's Blitz", () => {
    expect(heldDebuts(sched, lists, "2026-11-07").has("new")).toBe(false);
    expect(rollHoldouts(sched, lists, fresh, "2026-11-07").has("new")).toBe(false);
    expect(rollHoldouts(sched, lists, fresh, "2026-11-07").has("fresh")).toBe(true);
    expect(heldDebuts(sched, lists, "2026-11-08").has("fresh")).toBe(false);
    // Nov 8 holds only its own pair and the list still waiting for a day.
    expect([...rollHoldouts(sched, lists, fresh, "2026-11-08")].sort()).toEqual(["later", "x", "y"]);
  });
  it("keeps a new list that was never scheduled held, however long the schedule runs", () => {
    for (const day of ["2026-11-05", "2026-11-08", "2027-03-01"]) {
      expect(rollHoldouts(sched, lists, fresh, day).has("later"), day).toBe(true);
    }
  });
  it("never lets a held list stand in as a day's Blitz, and that day's pick stays put after the debut", () => {
    // Dates past the schedule take a date-seeded Blitz: never a debut list still waiting on that date.
    for (let d = 9; d <= 28; d++) {
      const date = `2026-11-${String(d).padStart(2, "0")}`;
      expect(blitzOfTheDay(sched, lists, date), date).not.toBe("later");
    }
    const before = blitzOfTheDay(sched, lists, "2026-11-20");
    const debuted = [...sched, { n: 5, date: "2026-11-25", id: "later", blitz: "c" }];
    expect(blitzOfTheDay(debuted, lists, "2026-11-20")).toBe(before);
  });
  it("lists without the flag are unaffected", () => {
    expect(heldDebuts(sched, lists, "2026-11-01")).toEqual(new Set(["new", "fresh", "later"]));
    expect(heldDebuts(sched, lists.map(({ id, blitz }) => ({ id, blitz })), "2026-11-01").size).toBe(0);
  });
});

describe("legacy daily results", () => {
  const g = (id: string, status: "lost" | "playing" = "lost") => ({ puzzleId: id, found: [1], lives: 0, log: [], status });
  const sched: DailyEntry[] = [
    { n: 1, date: "2026-10-20", id: "a", blitz: "m" },
    { n: 2, date: "2026-10-21", id: "b", blitz: "n" },
    { n: 3, date: "2026-10-22", id: "c", blitz: "o" },
    { n: 4, date: "2026-11-09", id: "d", blitz: "p" },
  ];
  it("lock a date's result kept only in the list's game, once, so a replay can't change the archive", () => {
    const s = { ...saved([]), games: { a: g("a"), b: g("b", "playing"), d: g("d") }, dailyGames: { "2026-10-22": g("c") } };
    const locked = lockLegacyDailies(s, sched, "2026-11-03");
    expect(Object.keys(locked.dailyGames ?? {}).sort()).toEqual(["2026-10-20", "2026-10-22"]);
    // Replaying a afterwards changes its game, not the locked day.
    const replayed = { ...locked, games: { ...locked.games, a: { ...g("a"), found: [1, 2, 3] } } };
    expect(dailyGame(replayed, sched[0])?.found).toEqual([1]);
    // Nothing to lock: the same save comes back.
    expect(lockLegacyDailies(locked, sched, "2026-11-03")).toBe(locked);
  });
});
