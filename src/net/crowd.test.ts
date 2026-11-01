import { describe, expect, it } from "vitest";
import {
  blitzBucket,
  blitzPercentile,
  compareWithPlayers,
  formatCount,
  MIN_PLAYERS,
  parseAverages,
  parseStats,
  pickCounts,
  realEnough,
  type CrowdStats,
} from "./crowd";

const estimate = [0, 1, 2, 5, 9, 12, 9, 5, 3, 2, 1];
const real = (n: number): CrowdStats => ({ n, counts: [n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], avg: 0 });

describe("the switch from the estimate to real players", () => {
  it("happens at MIN_PLAYERS (50)", () => {
    expect(MIN_PLAYERS).toBe(50);
    expect(realEnough(real(49))).toBe(false);
    expect(realEnough(real(50))).toBe(true);
    expect(realEnough(null)).toBe(false);
    expect(realEnough(undefined)).toBe(false);
  });

  it("draws the estimate below it and the real counts from it on", () => {
    expect(pickCounts(estimate, real(49))).toEqual({ counts: estimate, real: null });
    expect(pickCounts(estimate, null)).toEqual({ counts: estimate, real: null });
    const r = real(120);
    expect(pickCounts(estimate, r)).toEqual({ counts: r.counts, real: r });
  });
});

describe("Blitz buckets", () => {
  it("are 50 points wide, 0 to 100", () => {
    expect([0, 49, 50, 99, 742, 5000, 9999, -5].map(blitzBucket)).toEqual([0, 0, 1, 1, 14, 100, 100, 0]);
  });

  it("give a percentile only from 50 players", () => {
    const counts = Array(20).fill(0);
    counts[5] = 30; // 250-299
    counts[10] = 30; // 500-549
    expect(blitzPercentile({ n: 60, counts, avg: 400 }, 520)).toBe(75);
    expect(blitzPercentile({ n: 60, counts, avg: 400 }, 9000)).toBe(100);
    expect(blitzPercentile({ n: 49, counts, avg: 400 }, 520)).toBeNull();
  });
});

describe("parseStats", () => {
  it("takes the server's JSON (or a string of it)", () => {
    const raw = { n: 120, counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 65], avg: 7.4 };
    expect(parseStats(raw, "list")).toEqual(raw);
    expect(parseStats(JSON.stringify(raw), "list")).toEqual(raw);
    expect(parseStats({ ...raw, avg: "7.40" }, "list")?.avg).toBe(7.4);
    expect(parseStats({ ...raw, avg: null }, "list")?.avg).toBeNull();
  });

  it("always gives lists 11 buckets", () => {
    expect(parseStats({ n: 3, counts: [1, 2], avg: 0.7 }, "list")?.counts).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseStats({ n: 0, counts: [], avg: null }, "blitz")?.counts).toEqual([]);
  });

  it("refuses anything malformed", () => {
    for (const bad of [null, "nope", 5, {}, { n: -1, counts: [] }, { n: 2, counts: "x" }, { n: 2, counts: [1, -1] }, { n: 1.5, counts: [] }]) {
      expect(parseStats(bad, "list")).toBeNull();
    }
  });
});

describe("parseAverages and compareWithPlayers", () => {
  it("compares your average with real players' on lists that have enough of them", () => {
    const avgs = parseAverages([
      { list_id: "mountains", n: 200, avg: "5.25" },
      { list_id: "airports", n: 49, avg: 6 },
      { list_id: "bad" },
      "junk",
    ]);
    expect([...avgs.keys()]).toEqual(["mountains", "airports"]);
    const rows = compareWithPlayers(
      [
        { id: "mountains", found: [1, 2, 3, 4, 5, 6, 7] },
        { id: "mountains", found: [1, 2, 3] },
        { id: "airports", found: [1] },
        { id: "islands", found: [] },
      ],
      avgs,
    );
    expect(rows).toEqual([{ id: "mountains", games: 2, you: 5, players: 5.25, n: 200 }]);
    expect(parseAverages(null).size).toBe(0);
  });

  it("formats counts with thousands separators", () => {
    expect(formatCount(1203)).toBe("1,203");
    expect(formatCount(50)).toBe("50");
  });
});
