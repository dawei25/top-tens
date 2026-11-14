// Today's Fathom on the player's side (owner, Nov 14: "id like fathom to have a today's fathom- remove the unlimited
// fathom play for now"): one try a day, its state on Home and in the menu, its runs tagged with the day, and the share
// text with its number. The schedule itself: scripts/fathom/daily.test.ts.
import { describe, expect, it } from "vitest";
import { mergeSaves, sanitize } from "../net/sync/merge";
import { BANDS, shareLines, shareText, type Scored } from "./fathom";
import { dailyRun, FATHOM_DAILY_KEY, fathomTodayStatus, loadDailyLocal, recordRun, saveDailyLocal, type DailyLocal, type FathomRun } from "./fathom-history";
import { recentPlays } from "./history";
import type { Saved } from "./storage";

const day = { date: "2026-11-14", n: 1 };
const run = (startedAt: number, daily?: { date: string; n: number }): FathomRun => ({
  startedAt,
  finishedAt: startedAt + 60_000,
  ids: ["a", "b", "c", "d", "e"],
  guesses: [1, 2, 3, 4, 5],
  points: [100, 90, 80, 70, 60],
  ...(daily && { daily }),
});
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const local = (date: string, guesses: number[]): DailyLocal => ({ day: { date, n: 1 }, ids: ["a", "b", "c", "d", "e"], guesses, at: guesses.length, startedAt: 1 });

describe("Today's Fathom, for the player", () => {
  it("says new, playing, or the score, as Today's list does", () => {
    expect(fathomTodayStatus(undefined, day.date, undefined)).toEqual({ status: "new", done: false });
    expect(fathomTodayStatus(undefined, day.date, local(day.date, []))).toEqual({ status: "new", done: false });
    expect(fathomTodayStatus(undefined, day.date, local(day.date, [3]))).toEqual({ status: "playing", done: false });
    // Yesterday's game under way is not today's.
    expect(fathomTodayStatus(undefined, day.date, local("2026-11-13", [3]))).toEqual({ status: "new", done: false });
    // Finished (on this device or another, through the sync): its score, out of 500.
    const rec = recordRun(undefined, run(10, day));
    expect(fathomTodayStatus(rec, day.date, local(day.date, [3, 4]))).toEqual({ status: "400/500", done: true });
    expect(dailyRun(rec, day.date)?.startedAt).toBe(10);
    expect(dailyRun(recordRun(undefined, run(10)), day.date)).toBeUndefined();
  });

  it("keeps the day's game under way in this browser, and reads only its own shape", () => {
    const store = memory();
    expect(loadDailyLocal(store)).toBeUndefined();
    saveDailyLocal(local(day.date, [3]), store);
    expect(loadDailyLocal(store)).toEqual(local(day.date, [3]));
    store.setItem(FATHOM_DAILY_KEY, JSON.stringify({ day: { date: "Nov 14", n: 1 }, ids: [], guesses: [], at: 0, startedAt: 1 }));
    expect(loadDailyLocal(store)).toBeUndefined();
    store.setItem(FATHOM_DAILY_KEY, "{");
    expect(loadDailyLocal(store)).toBeUndefined();
  });

  it("tags a day's run with its date and number, through the sync too, and Past runs keeps both kinds", () => {
    const rec = recordRun(recordRun(undefined, run(10, day)), run(500));
    const saved: Saved = { games: {}, daily: {}, seenHelp: true, fathom: rec };
    expect(sanitize(saved).fathom!.runs!.find((r) => r.startedAt === 10)!.daily).toEqual(day);
    expect(mergeSaves(saved, { games: {}, daily: {}, seenHelp: true }, 1e6).fathom!.runs!.map((r) => r.daily)).toEqual([undefined, day]);
    expect(recentPlays(saved).map((p) => (p.kind === "fathom" ? (p.run.daily?.n ?? "endless") : p.kind))).toEqual(["endless", 1]);
    // A malformed day is dropped from the run, not the run.
    expect(sanitize({ ...saved, fathom: { runs: [{ ...run(10), daily: { date: "x", n: 0 } }] } }).fathom!.runs![0].daily).toBeUndefined();
  });

  it("shares a day's Fathom by its number", () => {
    const scored = BANDS.map((b) => ({ band: b.band, points: b.min }) as Scored);
    expect(shareText(scored, "https://toptentacle.io/#fathom", 12)).toBe("Fathom #12 215/500\n🟨 🟦 🟪 🟥 ⬛\nhttps://toptentacle.io/#fathom");
    expect(shareLines(312, ["close", "close", "near", "far", "lost"], undefined, 3)).toBe("Fathom #3 312/500\n🟦 🟦 🟪 🟥 ⬛");
    expect(shareText(scored)).toBe("Fathom 215/500\n🟨 🟦 🟪 🟥 ⬛");
  });
});
