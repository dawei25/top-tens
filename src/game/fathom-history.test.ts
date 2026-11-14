// Fathom's part of the player's save: Past runs, Stats, and the draws held back, and how two devices' copies merge
// (src/net/sync/merge.ts takes it through mergeSaves like the list games). Ten questions a game since Nov 14 (owner:
// "change it to 10 questions"): the five-question games from before keep their own total out of 500, and stay out of
// Stats' averages.
import { describe, expect, it } from "vitest";
import { mergeSaves, pruneBefore, sanitize } from "../net/sync/merge";
import { BANDS, MAX_TOTAL, QUESTIONS_PER_GAME } from "./fathom";
import {
  FATHOM_MAX,
  FATHOM_MAX_OLD,
  FATHOM_QUESTIONS,
  fathomStats,
  fathomTodayStatus,
  findRun,
  HOLD_GAMES,
  MAX_FATHOM_RUNS,
  mergeFathom,
  noteDraw,
  pruneFathom,
  recentIds,
  recordRun,
  runMax,
  runTotal,
  sanitizeFathom,
  type FathomRun,
} from "./fathom-history";
import { recentPlays } from "./history";
import type { Saved } from "./storage";

/** A ten-question game: 450 by default. */
const TEN = [100, 70, 40, 15, 0, 100, 70, 40, 15, 0];
const run = (startedAt: number, points = TEN, extra: Partial<FathomRun> = {}): FathomRun => ({
  startedAt,
  finishedAt: startedAt + 120_000,
  ids: points.map((_, i) => `q${i}-${startedAt}`),
  guesses: points.map((_, i) => i + 1),
  points,
  ...extra,
});
/** A game of five from before Nov 14: 225. */
const old = (startedAt: number, points = [100, 70, 40, 15, 0]) => run(startedAt, points);
const base = (): Saved => ({ games: {}, daily: {}, seenHelp: true });

describe("Fathom's history in the save", () => {
  it("keeps the game's own limits: ten questions, 1000 a game (500 before Nov 14), the last 3 games held back", () => {
    expect(FATHOM_QUESTIONS).toBe(QUESTIONS_PER_GAME);
    expect(FATHOM_MAX).toBe(MAX_TOTAL);
    expect([FATHOM_MAX, FATHOM_MAX_OLD]).toEqual([1000, 500]);
    expect(HOLD_GAMES).toBe(3);
    expect(BANDS.map((b) => b.band)).toEqual(["dead-on", "close", "near", "far", "lost"]);
  });

  it("records a finished game once, newest first, its total for Stats", () => {
    let rec = recordRun(undefined, run(1000));
    rec = recordRun(rec, run(5000, [...Array(9).fill(100), 99]));
    expect(rec.runs!.map((r) => r.startedAt)).toEqual([5000, 1000]);
    expect(rec.totals10).toEqual({ 1000: 450, 5000: 999 });
    expect(rec.totals).toBeUndefined();
    // The same game again (a reload on its results) changes nothing.
    expect(recordRun(rec, run(5000, [...Array(9).fill(100), 99]))).toBe(rec);
    expect(findRun(rec, 1000)?.points).toEqual(TEN);
    expect([runTotal(run(1)), runMax(run(1)), runTotal(old(1)), runMax(old(1))]).toEqual([450, 1000, 225, 500]);
  });

  it("keeps the last 100 games for Past runs, and every total for Stats", () => {
    let rec = recordRun(undefined, run(1));
    for (let i = 2; i <= MAX_FATHOM_RUNS + 20; i++) rec = recordRun(rec, run(i * 1000));
    expect(rec.runs).toHaveLength(MAX_FATHOM_RUNS);
    expect(Object.keys(rec.totals10!)).toHaveLength(MAX_FATHOM_RUNS + 20);
    expect(fathomStats(rec)!.played).toBe(MAX_FATHOM_RUNS + 20);
  });

  // UX 10: Stats shows the block before the first game, with placeholders; these are its numbers.
  it("counts games played, the average total and the best; nothing before the first game", () => {
    expect(fathomStats(undefined)).toBeNull();
    expect(fathomStats({})).toBeNull();
    const rec = recordRun(recordRun(undefined, run(1, Array(10).fill(80))), run(2, Array(10).fill(10)));
    expect(fathomStats(rec)).toEqual({ played: 2, avg: 450, best: 800 });
  });

  // The owner's switch to ten questions (Nov 14): a total out of 500 doesn't average with ones out of 1000.
  it("keeps the five-question games out of Stats, and each game's own total out of its own maximum", () => {
    const before = recordRun(recordRun(undefined, old(1)), old(2, [100, 100, 100, 100, 100]));
    expect(before.totals).toEqual({ 1: 225, 2: 500 });
    expect(fathomStats(before)).toBeNull();
    const after = recordRun(before, run(3));
    expect(after.totals).toEqual(before.totals);
    expect(after.totals10).toEqual({ 3: 450 });
    expect(fathomStats(after)).toEqual({ played: 1, avg: 450, best: 450 });
    // Home's key and the menu's tile: a day's game out of its own maximum.
    const day = { date: "2026-11-14", n: 1 };
    expect(fathomTodayStatus(recordRun(undefined, run(4, TEN, { daily: day })), day.date, undefined)).toEqual({ status: "450/1000", done: true });
    expect(fathomTodayStatus(recordRun(undefined, run(4, [100, 70, 40, 15, 0], { daily: day })), day.date, undefined).status).toBe("225/500");
  });

  it("remembers the last games drawn, finished or not, newest first", () => {
    let rec = noteDraw(undefined, { startedAt: 1, ids: ["a"] });
    for (const [t, id] of [[2, "b"], [3, "c"], [4, "d"]] as const) rec = noteDraw(rec, { startedAt: t, ids: [id] });
    expect(recentIds(rec)).toEqual([["d"], ["c"], ["b"]]);
    // The same draw twice is one.
    expect(recentIds(noteDraw(rec, { startedAt: 4, ids: ["d"] }))).toEqual([["d"], ["c"], ["b"]]);
  });

  it("shows on Past runs with the other games, by when it finished", () => {
    const saved: Saved = {
      ...base(),
      listRuns: [{ id: "x", startedAt: 1500, finishedAt: 1600, status: "won", found: [], lives: 5, hints: 0 }],
      fathom: recordRun(undefined, run(1000)),
    };
    expect(recentPlays(saved).map((p) => `${p.kind}:${p.at}`)).toEqual(["fathom:121000", "list:1600"]);
  });
});

describe("Fathom's history in the sync", () => {
  it("reads only what it can trust", () => {
    expect(sanitizeFathom(undefined)).toBeUndefined();
    expect(sanitizeFathom("x")).toBeUndefined();
    const bad = {
      runs: [run(1), { startedAt: "x" }, { ...run(2), points: [101, ...TEN.slice(1)] }, { ...run(3), guesses: [1] }, old(4)],
      totals: { 4: 225, x: 3, 5: 900 },
      totals10: { 1: 450, 6: 1001, y: 2 },
      recent: [{ startedAt: 1, ids: ["a"] }, { ids: [] }],
    };
    expect(sanitizeFathom(bad)).toEqual({ runs: [old(4), run(1)], totals: { 4: 225 }, totals10: { 1: 450 }, recent: [{ startedAt: 1, ids: ["a"] }] });
    // A game's time-outs: its own questions, once each.
    const timed = run(7, TEN, { timeouts: ["q4-7", "q4-7", "elsewhere"] });
    expect(sanitizeFathom({ runs: [timed] })!.runs![0].timeouts).toEqual(["q4-7"]);
  });

  // A game finished on the phone and one on the laptop: both are in Past runs and Stats on each, whichever syncs first.
  it("merges two devices' games, totals and draws, the same on both", () => {
    const phone = { ...recordRun(recordRun(undefined, old(500)), run(1000)), recent: [{ startedAt: 1000, ids: ["p"] }] };
    const laptop = { ...recordRun(recordRun(undefined, run(2000)), run(1000)), recent: [{ startedAt: 2000, ids: ["l"] }] };
    const a = mergeFathom(phone, laptop)!;
    expect(a).toEqual(mergeFathom(laptop, phone));
    expect(a.runs!.map((r) => r.startedAt)).toEqual([2000, 1000, 500]);
    expect(a.totals10).toEqual({ 1000: 450, 2000: 450 });
    expect(a.totals).toEqual({ 500: 225 });
    expect(recentIds(a)).toEqual([["l"], ["p"]]);
    // Idempotent: merging again changes nothing.
    expect(mergeFathom(a, phone)).toEqual(a);
    expect(mergeFathom(undefined, undefined)).toBeUndefined();
  });

  it("travels with the account through the save's merge, and a reset on another device clears it", () => {
    const local = { ...base(), fathom: recordRun(undefined, run(1000)) };
    const remote = { ...base(), fathom: noteDraw(recordRun(recordRun(undefined, run(5000)), old(4000)), { startedAt: 6000, ids: ["q"] }) };
    const merged = mergeSaves(local, remote, 10_000);
    expect(merged.fathom!.runs!.map((r) => r.startedAt)).toEqual([5000, 4000, 1000]);
    expect(recentIds(merged.fathom)).toEqual([["q"]]);
    expect(fathomStats(merged.fathom)!.played).toBe(2);
    // A copy from an older build without it keeps this device's.
    expect(mergeSaves(local, base(), 10_000).fathom).toEqual(sanitize(local).fathom);
    // A reset at 3000: the game before it goes, the ones after stay.
    const reset = mergeSaves({ ...merged, resetAt: 3000 }, remote, 10_000);
    expect(reset.fathom!.runs!.map((r) => r.startedAt)).toEqual([5000, 4000]);
    expect(pruneBefore(merged, 3000).fathom!.totals10).toEqual({ 5000: 450 });
    expect(pruneBefore(merged, 3000).fathom!.totals).toEqual({ 4000: 225 });
    expect(pruneFathom(undefined, 1)).toBeUndefined();
  });
});
