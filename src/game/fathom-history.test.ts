// Fathom's part of the player's save: Past runs, Stats, and the draws held back, and how two devices' copies merge
// (src/net/sync/merge.ts takes it through mergeSaves like the list games).
import { describe, expect, it } from "vitest";
import { mergeSaves, pruneBefore, sanitize } from "../net/sync/merge";
import { BANDS, MAX_TOTAL } from "./fathom";
import {
  FATHOM_MAX,
  fathomStats,
  findRun,
  HOLD_GAMES,
  MAX_FATHOM_RUNS,
  mergeFathom,
  noteDraw,
  pruneFathom,
  recentIds,
  recordRun,
  runTotal,
  sanitizeFathom,
  type FathomRun,
} from "./fathom-history";
import { recentPlays } from "./history";
import type { Saved } from "./storage";

const run = (startedAt: number, points = [100, 70, 40, 15, 0], extra: Partial<FathomRun> = {}): FathomRun => ({
  startedAt,
  finishedAt: startedAt + 120_000,
  ids: ["a", "b", "c", "d", "e"].map((x) => `${x}${startedAt}`),
  guesses: [1, 2, 3, 4, 5],
  points,
  ...extra,
});
const base = (): Saved => ({ games: {}, daily: {}, seenHelp: true });

describe("Fathom's history in the save", () => {
  it("keeps the game's own limits: 500 a game, the last 3 games held back", () => {
    expect(FATHOM_MAX).toBe(MAX_TOTAL);
    expect(HOLD_GAMES).toBe(3);
    expect(BANDS.map((b) => b.band)).toEqual(["dead-on", "close", "near", "far", "lost"]);
  });

  it("records a finished game once, newest first, its total for Stats", () => {
    let rec = recordRun(undefined, run(1000));
    rec = recordRun(rec, run(5000, [100, 100, 100, 100, 99]));
    expect(rec.runs!.map((r) => r.startedAt)).toEqual([5000, 1000]);
    expect(rec.totals).toEqual({ 1000: 225, 5000: 499 });
    // The same game again (a reload on its results) changes nothing.
    expect(recordRun(rec, run(5000, [100, 100, 100, 100, 99]))).toBe(rec);
    expect(findRun(rec, 1000)?.points).toEqual([100, 70, 40, 15, 0]);
    expect(runTotal(run(1))).toBe(225);
  });

  it("keeps the last 100 games for Past runs, and every total for Stats", () => {
    let rec = recordRun(undefined, run(1));
    for (let i = 2; i <= MAX_FATHOM_RUNS + 20; i++) rec = recordRun(rec, run(i * 1000));
    expect(rec.runs).toHaveLength(MAX_FATHOM_RUNS);
    expect(Object.keys(rec.totals!)).toHaveLength(MAX_FATHOM_RUNS + 20);
    expect(fathomStats(rec)!.played).toBe(MAX_FATHOM_RUNS + 20);
  });

  // UX 10: Stats shows the block before the first game, with placeholders; these are its numbers.
  it("counts games played, the average total and the best; nothing before the first game", () => {
    expect(fathomStats(undefined)).toBeNull();
    expect(fathomStats({})).toBeNull();
    const rec = recordRun(recordRun(undefined, run(1, [100, 100, 100, 50, 50])), run(2, [10, 10, 10, 10, 10]));
    expect(fathomStats(rec)).toEqual({ played: 2, avg: 225, best: 400 });
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
    const bad = { runs: [run(1), { startedAt: "x" }, { ...run(2), points: [101, 0, 0, 0, 0] }, { ...run(3), guesses: [1] }], totals: { 1: 225, x: 3, 2: 900 }, recent: [{ startedAt: 1, ids: ["a"] }, { ids: [] }] };
    expect(sanitizeFathom(bad)).toEqual({ runs: [run(1)], totals: { 1: 225 }, recent: [{ startedAt: 1, ids: ["a"] }] });
  });

  // A game finished on the phone and one on the laptop: both are in Past runs and Stats on each, whichever syncs first.
  it("merges two devices' games, totals and draws, the same on both", () => {
    const phone = { ...recordRun(undefined, run(1000)), recent: [{ startedAt: 1000, ids: ["p"] }] };
    const laptop = { ...recordRun(recordRun(undefined, run(2000)), run(1000)), recent: [{ startedAt: 2000, ids: ["l"] }] };
    const a = mergeFathom(phone, laptop)!;
    expect(a).toEqual(mergeFathom(laptop, phone));
    expect(a.runs!.map((r) => r.startedAt)).toEqual([2000, 1000]);
    expect(a.totals).toEqual({ 1000: 225, 2000: 225 });
    expect(recentIds(a)).toEqual([["l"], ["p"]]);
    // Idempotent: merging again changes nothing.
    expect(mergeFathom(a, phone)).toEqual(a);
    expect(mergeFathom(undefined, undefined)).toBeUndefined();
  });

  it("travels with the account through the save's merge, and a reset on another device clears it", () => {
    const local = { ...base(), fathom: recordRun(undefined, run(1000)) };
    const remote = { ...base(), fathom: noteDraw(recordRun(undefined, run(5000)), { startedAt: 6000, ids: ["q"] }) };
    const merged = mergeSaves(local, remote, 10_000);
    expect(merged.fathom!.runs!.map((r) => r.startedAt)).toEqual([5000, 1000]);
    expect(recentIds(merged.fathom)).toEqual([["q"]]);
    expect(fathomStats(merged.fathom)!.played).toBe(2);
    // A copy from an older build without it keeps this device's.
    expect(mergeSaves(local, base(), 10_000).fathom).toEqual(sanitize(local).fathom);
    // A reset at 3000: the game before it goes, the one after stays.
    const reset = mergeSaves({ ...merged, resetAt: 3000 }, remote, 10_000);
    expect(reset.fathom!.runs!.map((r) => r.startedAt)).toEqual([5000]);
    expect(pruneBefore(merged, 3000).fathom!.totals).toEqual({ 5000: 225 });
    expect(pruneFathom(undefined, 1)).toBeUndefined();
  });
});
