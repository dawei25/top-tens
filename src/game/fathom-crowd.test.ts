import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { blendCounts, ESTIMATE_WEIGHT, type CrowdStats } from "../net/crowd";
import { drawQuestions, QUESTIONS_PER_GAME } from "./fathom";
import {
  dayCounts,
  dayStanding,
  EXPECTED_EASY,
  EXPECTED_POINTS,
  expectedPoints,
  expectedTotal,
  FATHOM_BIN,
  FATHOM_BINS,
  simulatedCounts,
  SPREAD_ABOVE,
  SPREAD_BELOW,
  totalBin,
} from "./fathom-crowd";
import { readFullBank, readList } from "./fathom-name";
import { percentile } from "./par";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The total at which a share `p` of the counts lies below, reading each bin as spread evenly over its 10 points. */
function quantile(counts: number[], p: number): number {
  const target = p * sum(counts);
  let acc = 0;
  for (const [i, c] of counts.entries()) {
    if (c && acc + c >= target) return i * FATHOM_BIN + (FATHOM_BIN * (target - acc)) / c;
    acc += c;
  }
  return FATHOM_BINS * FATHOM_BIN;
}
const mean = (counts: number[]) => sum(counts.map((c, i) => c * (i * FATHOM_BIN + FATHOM_BIN / 2))) / sum(counts);

/** Real players' totals that day, by bin: [bin, players] pairs. */
function real(pairs: [bin: number, players: number][]): CrowdStats {
  const counts = Array<number>(FATHOM_BINS).fill(0);
  for (const [bin, players] of pairs) counts[bin] += players;
  return { n: sum(counts), counts, avg: null };
}

/** The usual day: an easy opener, then an estimate, a percent, a year and a name-it round. */
const USUAL = [{ easy: true }, {}, { round: "percent" as const }, { round: "year" as const }, { round: "name" as const }];

describe("the day's expected total", () => {
  it("sums each question's expected points: an easy one's, else its round's", () => {
    expect(expectedPoints({ easy: true })).toBe(EXPECTED_EASY);
    expect(expectedPoints({ round: "year", easy: true })).toBe(EXPECTED_EASY);
    expect(expectedPoints({})).toBe(EXPECTED_POINTS.estimate);
    expect(expectedPoints({ round: "percent" })).toBe(EXPECTED_POINTS.percent);
    expect(expectedTotal(USUAL)).toBe(270);
    expect(expectedTotal([])).toBe(0);
  });

  it("puts every day the real bank can draw between 175 and 325, and the usual one at 270", () => {
    const PUBLIC = join(import.meta.dirname, "..", "..", "public", "fathom");
    const lists = new Map(
      readdirSync(join(PUBLIC, "lists")).map((f) => [f.replace(/\.json$/, ""), readList(JSON.parse(readFileSync(join(PUBLIC, "lists", f), "utf8")))!]),
    );
    const bank = readFullBank(JSON.parse(readFileSync(join(PUBLIC, "questions.json"), "utf8")), lists)!;
    // A seeded draw, so the test is the same every run.
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const totals = Array.from({ length: 500 }, () => drawQuestions(bank, [], rand))
      .filter((day) => day.length === QUESTIONS_PER_GAME)
      .map(expectedTotal)
      .sort((a, b) => a - b);
    expect(totals.length).toBe(500);
    expect(totals[0]).toBeGreaterThanOrEqual(175);
    expect(totals.at(-1)).toBeLessThanOrEqual(325);
    expect(totals[totals.length >> 1]).toBe(270);
  });
});

describe("the simulated crowd", () => {
  it("is 30 virtual players (ESTIMATE_WEIGHT) in 50 bins of 10 points, none outside 0-500", () => {
    for (const expected of [175, 270, 325, 0, 500, 1e9, -5]) {
      const counts = simulatedCounts(expected);
      expect(counts).toHaveLength(FATHOM_BINS);
      expect(sum(counts)).toBeCloseTo(ESTIMATE_WEIGHT, 9);
      expect(counts.every((c) => c >= 0 && Number.isFinite(c))).toBe(true);
    }
    expect(ESTIMATE_WEIGHT).toBe(30);
  });

  it("is the same every time, and never asks Math.random", () => {
    const random = vi.spyOn(Math, "random");
    try {
      expect(simulatedCounts(270)).toEqual(simulatedCounts(270));
      expect(dayStanding(270, null, 312)).toEqual(dayStanding(270, null, 312));
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it("centres on the expected total: half the players score under it", () => {
    for (const expected of [175, 230, 270, 325]) {
      expect(Math.abs(quantile(simulatedCounts(expected), 0.5) - expected), String(expected)).toBeLessThan(1.5);
      // Scoring the expected total beats about half the day.
      expect(dayStanding(expected, null, expected).p).toBeGreaterThanOrEqual(47);
      expect(dayStanding(expected, null, expected).p).toBeLessThanOrEqual(53);
    }
  });

  it("skews right: the mean above the median, and a longer top tail than bottom", () => {
    for (const expected of [175, 230, 270, 325]) {
      const counts = simulatedCounts(expected);
      const [p10, median, p90] = [0.1, 0.5, 0.9].map((p) => quantile(counts, p));
      expect(mean(counts), String(expected)).toBeGreaterThan(median);
      expect(p90 - median, String(expected)).toBeGreaterThan(median - p10);
    }
    // The usual day: the mean about 5 over the median, the top 10% starting about 20 points further out than the bottom.
    const counts = simulatedCounts(270);
    const [p10, median, p90] = [0.1, 0.5, 0.9].map((p) => quantile(counts, p));
    expect(mean(counts)).toBeGreaterThan(median + 3);
    expect(p90 - median).toBeGreaterThan(median - p10 + 15);
    expect(SPREAD_ABOVE).toBeGreaterThan(SPREAD_BELOW);
  });

  it("looks like real players: the middle 80% within about 120 points either side", () => {
    const counts = simulatedCounts(270);
    const [p10, p90] = [quantile(counts, 0.1), quantile(counts, 0.9)];
    expect(270 - p10).toBeGreaterThan(95);
    expect(270 - p10).toBeLessThan(125);
    expect(p90 - 270).toBeGreaterThan(110);
    expect(p90 - 270).toBeLessThan(140);
    // Most players near the expected total: its bins are the tallest.
    const top = counts.indexOf(Math.max(...counts));
    expect(Math.abs(top * FATHOM_BIN + 5 - 270)).toBeLessThanOrEqual(30);
  });
});

describe("blending in real players (as lists do: the simulation counts as 30)", () => {
  it("adds up to the 30 simulated players plus every real one", () => {
    expect(sum(dayCounts(270, null))).toBeCloseTo(30, 9);
    expect(sum(dayCounts(270, real([])))).toBeCloseTo(30, 9);
    const day = real([
      [20, 4],
      [31, 7],
      [49, 1],
    ]);
    expect(sum(dayCounts(270, day))).toBeCloseTo(30 + 12, 9);
    // Bin by bin: the simulation plus the real counts, src/net/crowd.ts's blend exactly.
    expect(dayCounts(270, day)).toEqual(blendCounts(simulatedCounts(270), day));
    const sim = simulatedCounts(270);
    expect(dayCounts(270, day)[31]).toBeCloseTo(sim[31] + 7, 9);
    expect(dayCounts(270, day)[5]).toBeCloseTo(sim[5], 9);
  });

  it("is the simulation alone while nobody has played (no backend, or n 0)", () => {
    expect(dayCounts(270, null)).toEqual(simulatedCounts(270));
    expect(dayCounts(270, undefined)).toEqual(simulatedCounts(270));
    expect(dayStanding(270, null, 300)).toEqual({ p: dayStanding(270, real([]), 300).p, n: 0 });
  });

  it("lets real players take over: 30 weigh as much as the simulation, 300 make the curve about 91% real", () => {
    const share = (n: number) => {
      const day = real([[40, n]]);
      return dayCounts(270, day)[40] / sum(dayCounts(270, day));
    };
    expect(share(30)).toBeGreaterThan(0.5);
    expect(share(30)).toBeLessThan(0.51);
    expect(share(300)).toBeGreaterThan(0.909);
    expect(share(300)).toBeLessThan(0.912);
  });

  it("says how many real players stand behind it", () => {
    expect(dayStanding(270, null, 250).n).toBe(0);
    expect(dayStanding(270, real([[25, 12]]), 250).n).toBe(12);
    expect(dayStanding(270, real([[25, 30]]), 250).n).toBe(30);
  });
});

describe("where a total stands (par.ts's percentile: everyone below, plus half the tie)", () => {
  it("bins totals by 10, 500 with 490-499", () => {
    expect([0, 9, 10, 255, 489, 490, 499, 500].map(totalBin)).toEqual([0, 0, 1, 25, 48, 49, 49, 49]);
  });

  it("ranks hand-made days the way par.ts does", () => {
    // 30,000 real players: a third at 100-109, a third at 200-209, a third at 300-309. The simulated 30 move it by
    // at most 0.1 point.
    const day = real([
      [10, 10_000],
      [20, 10_000],
      [30, 10_000],
    ]);
    expect(dayStanding(270, day, 205)).toEqual({ p: 50, n: 30_000 });
    expect(dayStanding(270, day, 200).p).toBe(50);
    expect(dayStanding(270, day, 209).p).toBe(50);
    expect(dayStanding(270, day, 305).p).toBe(83);
    expect(dayStanding(270, day, 105).p).toBe(17);
    expect(dayStanding(270, day, 150).p).toBe(33);
    expect(dayStanding(270, day, 0).p).toBe(0);
    // Always game/par's percentile on the blend, by bin.
    for (const total of [0, 37, 150, 205, 270, 333, 488, 500]) {
      expect(dayStanding(270, day, total).p).toBe(Math.min(99, percentile(dayCounts(270, day), totalBin(total))));
      expect(dayStanding(270, null, total).p).toBe(Math.min(99, percentile(simulatedCounts(270), totalBin(total))));
    }
  });

  it("never says better than 100%: a top score is 99, less when others tie it", () => {
    expect(dayStanding(270, null, 500).p).toBe(99);
    expect(dayStanding(270, real([[10, 5000]]), 495).p).toBe(99);
    // One real player at 500 (you, once your total is in, as lists count everyone): (30 below + half of that one) of 31.
    expect(dayStanding(270, real([[49, 1]]), 500).p).toBe(98);
  });

  it("climbs with the total: a better total never stands lower", () => {
    const day = real([
      [12, 3],
      [27, 9],
      [44, 2],
    ]);
    for (const r of [null, day]) {
      let last = -1;
      for (let t = 0; t <= 500; t++) {
        const { p } = dayStanding(270, r, t);
        expect(p).toBeGreaterThanOrEqual(last);
        last = p;
      }
    }
  });
});
