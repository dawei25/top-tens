import { describe, expect, it } from "vitest";
import { percentile } from "../game/par";
import {
  blendAverage,
  blendCounts,
  blitzBucket,
  blitzStanding,
  compareWithPlayers,
  ESTIMATE_WEIGHT,
  formatCount,
  parseAverages,
  parseStats,
  standing,
  type CrowdStats,
} from "./crowd";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** A list's estimate as par.json has it: 1,000 simulated players, typical score (par) 5. */
const estimate = [3, 25, 58, 130, 177, 214, 179, 113, 63, 27, 11];
const PAR = 5;
/** Real players with these counts per score (or 50-point bucket): n and the mean, as list_stats answers. */
const players = (counts: number[]): CrowdStats => {
  const n = sum(counts);
  return { n, counts, avg: n ? sum(counts.map((c, i) => c * i)) / n : null };
};
/** n real players who all scored `score`: testers who know the list (8) or strugglers (2). */
const all = (n: number, score: number) => players(Array.from({ length: 11 }, (_, i) => (i === score ? n : 0)));
/** The share of the blended players that is real. */
const realShare = (blended: number[], real: CrowdStats) => sum(real.counts) / sum(blended);

describe("the estimate and real players, blended (W virtual players, no cliff)", () => {
  it("counts the estimate as W = 30 players", () => {
    expect(ESTIMATE_WEIGHT).toBe(30);
  });

  it("n = 0 is the estimate exactly: same counts, same percentile for every score, par as the average", () => {
    const none: CrowdStats = { n: 0, counts: Array(11).fill(0), avg: null };
    for (const real of [none, null, undefined]) {
      expect(blendCounts(estimate, real)).toBe(estimate);
      expect(blendAverage(PAR, real)).toBe(PAR);
      for (let s = 0; s <= 10; s++) expect(standing(estimate, real, s)).toEqual({ p: percentile(estimate, s), n: 0, estimated: true });
    }
  });

  it("n = 30 weighs both equally", () => {
    const real = all(30, 8);
    const blended = blendCounts(estimate, real);
    expect(blended).toHaveLength(11);
    expect(sum(blended)).toBeCloseTo(60, 9);
    expect(realShare(blended, real)).toBeCloseTo(0.5, 9);
    // Each score: half the estimate's share plus half the real players'.
    for (let s = 0; s <= 10; s++) expect(blended[s] / 60).toBeCloseTo(estimate[s] / sum(estimate) / 2 + real.counts[s] / 60, 9);
    expect(blendAverage(PAR, real)).toBeCloseTo((PAR + 8) / 2, 9);
    // From W real players the line names them, without "(estimated)"; one fewer, still estimated.
    expect(standing(estimate, real, 5)).toMatchObject({ n: 30, estimated: false });
    expect(standing(estimate, all(29, 8), 5)).toMatchObject({ n: 29, estimated: true });
  });

  it("n = 300 is about 91% real", () => {
    const real = players([3, 9, 21, 33, 45, 51, 48, 39, 27, 15, 9]);
    expect(real.n).toBe(300);
    const blended = blendCounts(estimate, real);
    expect(realShare(blended, real)).toBeCloseTo(300 / 330, 9);
    expect(realShare(blended, real)).toBeGreaterThan(0.9);
    expect(blendAverage(PAR, real)).toBeCloseTo((30 * PAR + 300 * real.avg!) / 330, 9);
    // The percentile is close to the real one, not the estimate's.
    const p = standing(estimate, real, 7)!.p;
    expect(Math.abs(p - percentile(real.counts, 7))).toBeLessThan(Math.abs(p - percentile(estimate, 7)));
  });

  it("keeps a handful of testers from swinging a list: 5 perfect scores move the average by under 1", () => {
    const avg = blendAverage(PAR, all(5, 10))!;
    expect(avg - PAR).toBeCloseTo((5 * (10 - PAR)) / 35, 9);
    expect(avg - PAR).toBeLessThan(1);
    // The line still says "(estimated)", and the curve is still mostly the estimate.
    expect(standing(estimate, all(5, 10), 6)!.estimated).toBe(true);
    expect(realShare(blendCounts(estimate, all(5, 10)), all(5, 10))).toBeCloseTo(5 / 35, 9);
  });

  it("has no cliff: each player moves the average by at most 1/(W + n) of the gap, all the way past 50", () => {
    let last = blendAverage(PAR, null)!;
    for (let n = 1; n <= 500; n++) {
      const avg = blendAverage(PAR, all(n, 9))!;
      expect(avg).toBeGreaterThan(last);
      expect(avg - last).toBeLessThanOrEqual((9 - PAR) / (ESTIMATE_WEIGHT + n) + 1e-12);
      last = avg;
    }
  });

  it("uses real players only for a list with no estimate (missing from par.json)", () => {
    const real = players([0, 2, 4, 6, 8, 6, 4, 2, 0, 0, 0]);
    expect(blendCounts(undefined, real)).toBe(real.counts);
    expect(blendCounts([], real)).toBe(real.counts);
    expect(blendAverage(undefined, real)).toBe(real.avg);
    expect(blendAverage(undefined, null)).toBeNull();
    // Nothing to stand on below W players; from W, the real percentile, named.
    expect(standing(undefined, all(29, 4), 4)).toBeNull();
    expect(standing(undefined, real, 4)).toEqual({ p: percentile(real.counts, 4), n: 32, estimated: false });
    expect(standing(undefined, null, 4)).toBeNull();
  });
});

describe("Blitz buckets", () => {
  it("are 50 points wide, 0 to 100", () => {
    expect([0, 49, 50, 99, 742, 5000, 9999, -5].map(blitzBucket)).toEqual([0, 0, 1, 1, 14, 100, 100, 0]);
  });

  it("blend the same way, bucket by bucket, however far either side reaches", () => {
    // An estimate up to 249 points, real players up to 549: the blend runs to 549, a missing bucket counting 0.
    const est = [10, 30, 40, 15, 5];
    const real = players([0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 10]);
    const blended = blendCounts(est, real);
    expect(blended).toHaveLength(11);
    expect(blended.slice(0, 5)).toEqual([3, 9, 12, 14.5, 11.5]);
    expect(blended.slice(5)).toEqual([0, 0, 0, 0, 0, 10]);
    expect(sum(blended)).toBeCloseTo(60, 9);
    expect(blendCounts(est, null)).toBe(est);
    expect(standing(est, real, blitzBucket(520))).toMatchObject({ p: percentile(blended, 10), n: 30, estimated: false });
  });

  it("have no estimate today: real players only, and a line from W players", () => {
    const counts = Array(20).fill(0);
    counts[5] = 15; // 250-299
    counts[10] = 15; // 500-549
    expect(blitzStanding({ n: 30, counts, avg: 400 }, 520)).toEqual({ p: 75, n: 30, estimated: false });
    expect(blitzStanding({ n: 30, counts, avg: 400 }, 9000)).toEqual({ p: 100, n: 30, estimated: false });
    counts[10] = 14;
    expect(blitzStanding({ n: 29, counts, avg: 400 }, 520)).toBeNull();
    expect(blitzStanding(null, 520)).toBeNull();
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
