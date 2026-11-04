import { describe, expect, it } from "vitest";
import type { DailyEntry } from "../src/game/daily";
import { addDays, assignBlitz, BLITZ_RERUN_DAYS, nextEntries, waitingDebuts, type ListInfo, type Verdict } from "./schedule";

/** A real judge's verdict: `list` approves it for Today's list, `blitz` for Today's Blitz. */
const verdict = (id: string, { list = false, blitz = false, priority = 5, depth = 20 } = {}): Verdict => ({
  id,
  decision: list ? "daily-list" : "free-play",
  priority,
  summary: id,
  judgedAt: "2026-11-04",
  scores: { blitzDepth: blitz ? 5 : 2, recognizability: 5, data: 5 },
  blitzCasual: { scored: depth },
});
const verdicts = (...vs: Verdict[]) => new Map(vs.map((v) => [v.id, v]));
const list = (id: string, category: string, extra: Partial<ListInfo> = {}): ListInfo => ({ id, category, blitz: true, ...extra });

describe("Today's list", () => {
  const lists = [
    list("old-geo", "Geography"),
    list("old-sport", "Sports"),
    list("new-food", "Food", { debut: true }),
    list("new-geo", "Geography", { debut: true }),
  ];
  const v = verdicts(
    verdict("old-geo", { list: true, priority: 10 }),
    verdict("old-sport", { list: true, priority: 9 }),
    verdict("new-food", { list: true, priority: 3 }),
    verdict("new-geo", { list: true, priority: 3 }),
  );
  const past: DailyEntry[] = [{ n: 1, date: "2026-11-01", id: "x", blitz: "y" }];

  it("runs new lists before lists already in random play, whatever their priority", () => {
    const next = nextEntries(past, 2, "2026-11-02", v, [...lists, list("x", "Sports"), list("y", "Business")]);
    expect(next.map((e) => e.id)).toEqual(["new-food", "new-geo"]);
  });
  it("never runs the day before's category when another will do, debut or not", () => {
    const after = [...past, { n: 2, date: "2026-11-02", id: "z", blitz: "y" }];
    const next = nextEntries(after, 3, "2026-11-03", v, [...lists, list("x", "Sports"), list("y", "Business"), list("z", "Food")]);
    // Food ran yesterday: the Geography debut goes first, then the Food one, then the old lists.
    expect(next.map((e) => e.id)).toEqual(["new-geo", "new-food", "old-sport"]);
  });
  it("never schedules a builder's verdict or a list that already ran", () => {
    const builder = verdicts({ ...verdict("new-food", { list: true }), by: "builder" } as Verdict, verdict("x", { list: true }));
    // readVerdicts drops builder verdicts; a map without them schedules nothing new.
    builder.delete("new-food");
    expect(nextEntries(past, 2, "2026-11-02", builder, [...lists, list("x", "Sports")])).toEqual([]);
  });
});

describe("Today's Blitz", () => {
  const lists = [
    list("day1", "Geography"),
    list("day2", "Sports"),
    list("fresh", "Business"),
    list("ran-geo", "Geography"),
    list("ran-music", "Music"),
    list("ran-sport", "Sports"),
    list("recent-blitz", "Music"),
    list("later", "Music"),
    list("unready", "Music", { blitz: false }),
  ];
  const v = verdicts(
    verdict("fresh", { blitz: true }),
    verdict("ran-geo", { blitz: true }),
    verdict("ran-music", { blitz: true }),
    verdict("ran-sport", { blitz: true }),
    verdict("recent-blitz", { blitz: true }),
    verdict("later", { blitz: true, list: true }),
    verdict("unready", { blitz: true }),
  );
  // ran-sport ran first, then ran-geo (as a Blitz), then ran-music; recent-blitz ran as a Blitz on Nov 10.
  const schedule: DailyEntry[] = [
    { n: 1, date: "2026-09-01", id: "ran-sport", blitz: "q" },
    { n: 2, date: "2026-09-20", id: "p", blitz: "ran-geo" },
    { n: 2, date: "2026-09-25", id: "ran-music", blitz: "q2" },
    { n: 3, date: "2026-11-10", id: "p3", blitz: "recent-blitz" },
    { n: 6, date: "2026-11-30", id: "later", blitz: "r" },
  ];

  it("takes a list that never ran first, then reruns a list that ran, so no day waits", () => {
    const entries: DailyEntry[] = [
      { n: 4, date: "2026-11-20", id: "day1" },
      { n: 5, date: "2026-11-21", id: "day2" },
    ];
    assignBlitz(entries, schedule, v, lists);
    expect(entries[0].blitz).toBe("fresh");
    // No fresh Blitz left: the rerun that ran longest ago, outside the day's category (ran-sport is Sports, like day2).
    expect(entries[1].blitz).toBe("ran-geo");
  });
  it("never reruns the day's category, a Blitz from the last 30 days, a later day's list, or a list not Blitz-ready", () => {
    const days = Array.from({ length: 5 }, (_, i): DailyEntry => ({ n: 10 + i, date: addDays("2026-11-20", i), id: "day2" }));
    assignBlitz(days, [...schedule, { n: 3, date: "2026-11-19", id: "s", blitz: "fresh" }], v, lists);
    const picks = days.map((d) => d.blitz);
    for (const p of picks) expect(["ran-sport", "recent-blitz", "later", "unready", "day2"]).not.toContain(p);
    // Each rerun waits BLITZ_RERUN_DAYS before it runs as a Blitz again: two reruns, then the days stay open.
    expect(picks).toEqual(["ran-geo", "ran-music", undefined, undefined, undefined]);
    expect(BLITZ_RERUN_DAYS).toBe(30);
  });
  it("a rerun goes back into rotation 30 days after its last Blitz", () => {
    const entries: DailyEntry[] = [{ n: 4, date: "2026-12-10", id: "day2" }];
    // recent-blitz ran as a Blitz on Nov 10: exactly 30 days before Dec 10, so it may run again.
    assignBlitz(entries, [...schedule, { n: 7, date: "2026-12-01", id: "u", blitz: "fresh" }, { n: 8, date: "2026-12-02", id: "w", blitz: "ran-geo" }, { n: 9, date: "2026-12-03", id: "w2", blitz: "ran-music" }], v, lists);
    expect(entries[0].blitz).toBe("recent-blitz");
  });
});

describe("new lists waiting for a day", () => {
  it("names the unjudged and the ones no daily will take", () => {
    const lists = [list("a", "Food", { debut: true }), list("b", "Food", { debut: true }), list("c", "Food", { debut: true }), list("d", "Food", { debut: true })];
    const v = verdicts(verdict("b", { list: true }), verdict("c"), verdict("d"));
    const schedule: DailyEntry[] = [{ n: 1, date: "2026-11-01", id: "x", blitz: "d" }];
    expect(waitingDebuts(schedule, v, lists)).toEqual({ unjudged: ["a"], stuck: ["c"] });
  });
});
