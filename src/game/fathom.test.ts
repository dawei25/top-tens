import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  amountText,
  askFor,
  BAND_CHARS,
  bandLabel,
  bandOf,
  currentYear,
  curve,
  CURVE_EDGE,
  drawQuestions,
  editField,
  FATHOM_KEY,
  fathomScore,
  figureParts,
  formatAmount,
  formatDigits,
  formatWords,
  GAME_ROUNDS,
  groupDigits,
  guessError,
  isSizeQuestion,
  loadFathom,
  lockIn,
  MAX_SIZE_PER_GAME,
  MAX_TOTAL,
  MIN_PLAYERS,
  missText,
  newGame,
  nextQuestion,
  offAxis,
  parseNumber,
  percentScore,
  phaseOf,
  playersLine,
  pointsOff,
  readBank,
  readGuess,
  readNumber,
  resumable,
  roundOf,
  saveFathom,
  scoreFor,
  scoreGame,
  shareText,
  startGame,
  timesOff,
  totalOf,
  unitShown,
  yearScore,
  yearsOff,
  nameOff,

  PER_POINT,
  PER_STEP,
  YEAR_STRETCH,
  singular,
  stepsScore,
  TAIL,
  type FathomKind,
  type FathomQuestion,
  type Round,
} from "./fathom";
import { fnv, trainLexicon } from "./junk";
import {
  asOfText,
  bestAnswers,
  goodAnswers,
  MIN_GOOD,
  nameLine,
  nameListIds,
  readFullBank,
  readList,
  readName,
  readNameQuestion,
  LINE_MAX,
  PLACES,
  rewrites,
  withArticle,
  type NameList,
  type NameRead,
} from "./fathom-name";

/** A seeded random (mulberry32), so a draw can be repeated. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (id: string, kind: FathomKind, extra: Partial<FathomQuestion> = {}): FathomQuestion => ({
  id,
  kind,
  question: `${id}?`,
  unit: "things",
  answer: 100,
  fact: "a fact",
  source: { title: id, url: `https://en.wikipedia.org/wiki/${id}` },
  ...extra,
});

// The owner, after playing the beta: scores against a judge's "typical miss" were confusing ("most people miss by about
// x feels made up", and 10x off still scored well where that was usual). One plain rule for every question now.
describe("scoring: plain closeness, the same rule for every question", () => {
  it("is 100 for an exact guess", () => {
    expect(fathomScore(330, 330)).toBe(100);
    expect(fathomScore(0.1, 0.1)).toBe(100);
  });
  it("is the larger of round(100 x (1 - d)^2) and 30 x (2 - d), d the distance in powers of ten, either way", () => {
    for (const r of [1.02, 1.1, 1.3, 1.7, 2, 3, 5, 9.9, 10, 30, 99]) {
      const d = Math.log10(r);
      const want = Math.round(Math.max(100 * Math.max(0, 1 - d) ** 2, 30 * (2 - d)));
      expect(fathomScore(100 * r, 100), `${r}x too high`).toBe(want);
      expect(fathomScore(100 / r, 100), `${r}x too low`).toBe(want);
    }
  });
  // The owner, Nov 14, on 30,000 years for Homo sapiens (300,000): "shouldn't get 0 points for this we were within one
  // magnitude should get more like 25-40 points". Near the answer the curve is as it was; 10x off now scores 30, and
  // only 100x off scores 0.
  it("scores the rule's landmarks: 10% off 92, 25% off 82, half or double 51, 3x 46, 5x 39, 10x 30, 30x 16, 100x and beyond 0", () => {
    expect(fathomScore(110, 100)).toBe(92);
    expect(fathomScore(125, 100)).toBe(82);
    expect(fathomScore(200, 100)).toBe(51);
    expect(fathomScore(50, 100)).toBe(51);
    expect(fathomScore(300, 100)).toBe(46);
    expect(fathomScore(500, 100)).toBe(39);
    expect(fathomScore(1000, 100)).toBe(30);
    expect(fathomScore(10, 100)).toBe(30);
    expect(fathomScore(3000, 100)).toBe(16);
    expect(fathomScore(10000, 100)).toBe(0);
    expect(fathomScore(1, 100)).toBe(0);
    expect(fathomScore(1e30, 1)).toBe(0);
    // His guess: 30,000 years for 300,000, inside his 25 to 40.
    expect(fathomScore(30000, 300000)).toBe(30);
  });
  it("never goes up as the guess gets further off", () => {
    let last = 101;
    for (let r = 1; r <= 200; r *= 1.01) {
      const p = fathomScore(100 * r, 100);
      expect(p).toBeLessThanOrEqual(last);
      last = p;
    }
  });
  // The judge's estimate stays in the file, but it no longer moves a score: the same miss scores the same everywhere.
  it("ignores the question's typical miss", () => {
    const bank = [q("a", "body", { typical: 1.3 }), q("b", "food", { typical: 30 })];
    const g = nextQuestion(lockIn(nextQuestion(lockIn(newGame(["a", "b"]), 200)), 200));
    expect(scoreGame(g, bank).map((s) => s.points)).toEqual([51, 51]);
  });
  // A reveal said "spot on" beside 99 points (Nov 5 review): whatever reads as spot on scores full marks.
  it("is 100 whenever the reveal says spot on, and only then", () => {
    expect(fathomScore(333, 330)).toBe(100);
    expect(fathomScore(327, 330)).toBe(100);
    for (let guess = 95; guess <= 105; guess += 0.25) {
      if (timesOff(guess, 100) === "spot on") expect(fathomScore(guess, 100), `${guess}`).toBe(100);
      else expect(fathomScore(guess, 100), `${guess}`).toBeLessThan(100);
    }
  });
});

describe("How to play's line: the closer your guess, the more points", () => {
  // The game says no scoring line since Nov 14 (the owner); How to play's has to be true.
  it("holds: a closer guess never scores less", () => {
    const guesses = [100, 120, 150, 200, 400, 1000];
    const pts = guesses.map((g) => fathomScore(g, 100));
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeLessThanOrEqual(pts[i - 1]);
    for (const guess of [50, 200]) expect(Math.abs(fathomScore(guess, 100) - 50)).toBeLessThanOrEqual(1);
  });
});

/** A percent question and a year question, as the bank holds them. */
const pct = (id: string, kind: FathomKind, extra: Partial<FathomQuestion> = {}) => q(id, kind, { round: "percent", unit: "percent", answer: 71, ...extra });
const yr = (id: string, kind: FathomKind, extra: Partial<FathomQuestion> = {}) => q(id, kind, { round: "year", unit: "year", answer: 2007, ...extra });

/** The year the tests score a year round from (the owner's calibration was in 2026). */
const NOW = 2026;

/** A percent's points-off half, as the old rule scored it: 100 - 3 a point, rounded, never under 0. */
const byPoints = (guess: number, answer: number) => Math.max(0, Math.round(100 - PER_POINT * Math.abs(guess - answer)));

// The owner's revamp: two new rounds beside the estimate. They were scored by points off and years off, until the owner
// played: "0.8% for 25% (beetles)" scored 27 and "1984 for 1967 (first heart transplant)" 15, "theres no way my second
// guess was considered worse". A year now scores on the estimate's curve by how many times off how long ago it was; a
// percent is the average of points off and how many times off its share is (on its side of 50). A first try scored a
// percent only by times off, and harder on years (3 x log10): "i would give some points for 0.8, not 0, 2.5 for 5 isnt
// that bad id give 60-75 points, in general a lot of these were fine before".
describe("rounds", () => {
  it("a question without a round is an estimate", () => {
    expect(roundOf(q("a", "body"))).toBe("estimate");
    expect(roundOf(pct("p", "body"))).toBe("percent");
    expect(roundOf(yr("y", "body"))).toBe("year");
  });

  it("is one curve: the larger of 100 x (1 - |d|)^2 and 30 x (2 - |d|), rounded, 30 at |d| = 1, 0 from |d| = 2", () => {
    expect(TAIL).toBe(30);
    expect(CURVE_EDGE).toBe(2);
    expect([0, 0.1, -0.1, 0.3, 0.5, 1, -1, 1.5, 2, -2, 3].map(curve)).toEqual([100, 81, 81, 51, 45, 30, 30, 15, 0, 0, 0]);
    for (const r of [1.1, 2, 3, 9.9, 50]) expect(fathomScore(100 * r, 100)).toBe(curve(Math.log10(r)));
    // The near part until about 1.9x off, the tail from there: nothing jumps where they meet.
    for (let d = 0; d <= 2.5; d += 0.001) expect(Math.abs(curve(d + 0.001) - curve(d)), `${d}`).toBeLessThanOrEqual(1);
  });

  it("percent: the average of points off and times off on the answer's side of 50, spot on (within half a point) 100", () => {
    expect(PER_POINT).toBe(3);
    expect(percentScore(71, 71)).toBe(100);
    expect(percentScore(71.4, 71)).toBe(100);
    expect(percentScore(70.6, 71)).toBe(100);
    // Up to 50, the shares themselves: 20 for 25 is 5 points (85) and 1.25x low (82).
    expect(percentScore(20, 25)).toBe(Math.round((byPoints(20, 25) + fathomScore(20, 25)) / 2));
    expect(percentScore(20, 25)).toBe(84);
    expect([0.8, 5, 10, 15, 20, 30, 40, 50].map((g) => percentScore(g, 25))).toEqual([21, 40, 52, 66, 84, 85, 59, 38]);
    expect([1, 5, 10].map((g) => percentScore(g, 2.5))).toEqual([72, 72, 60]);
    // Past 50, what's left: 65 for 71 is 6 points (82) and 35 left against 29.
    expect(percentScore(65, 71)).toBe(Math.round((82 + fathomScore(35, 29)) / 2));
    expect([50, 60, 65, 70, 80, 90].map((g) => percentScore(g, 71))).toEqual([48, 71, 83, 97, 72, 45]);
    // Either side of 50 alike: 90 for 99 is 10 for 1 (9 points, 73, and 10x off, 30).
    expect(percentScore(90, 99)).toBe(percentScore(10, 1));
    expect(percentScore(90, 99)).toBe(52);
    expect(percentScore(80, 75)).toBe(percentScore(20, 25));
    // 0 and 100 are fair guesses, their shares taken as 0.5 and 99.5.
    expect(percentScore(0, 71)).toBe(22);
    expect(percentScore(100, 71)).toBe(10);
    expect(percentScore(100, 2)).toBe(5);
    expect(percentScore(0, 2)).toBe(68);
    // The blend's halves at the far end: 100 points off and 100x off both 0, so a percent can still score 0.
    expect(percentScore(100, 0.5)).toBe(0);
    // Half a point is not spot on, and only spot on is 100.
    expect(percentScore(71.5, 71)).toBe(99);
    expect(percentScore(50.5, 50)).toBeLessThan(100);
  });

  it("year: how many times off how long ago it was, the exact year 100", () => {
    expect(YEAR_STRETCH).toBe(2);
    expect(yearScore(2007, 2007, NOW)).toBe(100);
    expect([1984, 1980, 1960, 1950, 2000, 1900].map((g) => yearScore(g, 1967, NOW))).toEqual([51, 61, 81, 61, 39, 40]);
    expect([2005, 2006, 2008, 2010, 2000, 1995].map((g) => yearScore(g, 2007, NOW))).toEqual([83, 91, 91, 72, 53, 47]);
    expect([1920, 1950, 1880, 1850].map((g) => yearScore(g, 1903, NOW))).toEqual([76, 47, 72, 51]);
    expect(yearScore(2010, 2005, NOW)).toBe(58);
    expect(yearScore(2000, 1992, NOW)).toBe(59);
    // Ten years off is far for something 19 years ago and close for something 1,000 years ago.
    expect(yearScore(2017, 2007, NOW)).toBe(41);
    expect(yearScore(1076, 1066, NOW)).toBeGreaterThan(95);
    // 10x off how long ago (19 years ago against 190) scores 0, as 100x off an estimate does.
    expect(yearScore(NOW - 190, 2007, NOW)).toBe(0);
    expect(yearScore(1066, 2007, NOW)).toBe(0);
    // This year and later count as a year ago: still finite, still not full marks.
    expect(yearScore(NOW, NOW - 1, NOW)).toBe(99);
    expect(yearScore(NOW + 50, 1967, NOW)).toBe(yearScore(NOW - 1, 1967, NOW));
    // Measured from this year when no year is given.
    expect(yearScore(1984, 1967)).toBe(yearScore(1984, 1967, currentYear()));
  });

  it("scores each question by its round's rule", () => {
    expect(scoreFor(q("a", "body"), 200)).toBe(fathomScore(200, 100));
    expect(scoreFor(pct("p", "body"), 65)).toBe(83);
    expect(scoreFor(yr("y", "body"), 2004, NOW)).toBe(76);
    expect(scoreFor(yr("y", "body"), 2004)).toBe(yearScore(2004, 2007));
    const bank = [q("a", "body"), pct("p", "food"), yr("y", "space")];
    const g = [200, 65, 2004].reduce((game, guess) => nextQuestion(lockIn(game, guess)), newGame(["a", "p", "y"]));
    expect(scoreGame(g, bank).map((s) => s.points)).toEqual([51, 83, yearScore(2004, 2007)]);
  });

  it("never goes up as a guess gets further off, on either side", () => {
    const walks: [string, (g: number) => number, number, number, number, number][] = [
      ["percent 25", (g) => percentScore(g, 25), 25, 0, 100, 0.25],
      ["percent 50", (g) => percentScore(g, 50), 50, 0, 100, 0.25],
      ["percent 71", (g) => percentScore(g, 71), 71, 0, 100, 0.25],
      ["percent 2.5", (g) => percentScore(g, 2.5), 2.5, 0, 100, 0.25],
      ["year 1903", (g) => yearScore(g, 1903, NOW), 1903, 1000, NOW + 5, 1],
      ["year 2007", (g) => yearScore(g, 2007, NOW), 2007, 1000, NOW + 5, 1],
    ];
    for (const [name, score, answer, low, high, step] of walks) {
      let last = 101;
      for (let g = answer; g <= high; g += step) {
        expect(score(g), `${name}: ${g}`).toBeLessThanOrEqual(last);
        last = score(g);
      }
      last = 101;
      for (let g = answer; g >= low; g -= step) {
        expect(score(g), `${name}: ${g}`).toBeLessThanOrEqual(last);
        last = score(g);
      }
    }
  });

  // UX 21: How to play's plain line, borne out by each round's numbers.
  it("bears out the plain line in each round", () => {
    expect(percentScore(60, 50)).toBe(78);
    expect(percentScore(40, 50)).toBe(76);
    expect(percentScore(51, 50)).toBe(98);
    expect(yearScore(1910, 1900, NOW)).toBe(86);
    expect(yearScore(1890, 1900, NOW)).toBe(87);
    expect(yearScore(1901, 1900, NOW)).toBe(99);
  });

  it("says a percent's miss in points, a year's in years early or late", () => {
    // In percentage points, without the word (the review, Nov 9: the score is the reveal's points).
    expect(pointsOff(65, 71)).toBe("6 too low");
    expect(pointsOff(72, 71)).toBe("1 too high");
    expect(pointsOff(73.5, 71)).toBe("2.5 too high");
    expect(pointsOff(71.96, 71)).toBe("1 too high");
    expect(pointsOff(71.3, 71)).toBe("spot on");
    expect(pointsOff(0, 71)).toBe("71 too low");
    expect(yearsOff(2004, 2007)).toBe("3 years early");
    expect(yearsOff(2008, 2007)).toBe("1 year late");
    expect(yearsOff(1066, 2007)).toBe("941 years early");
    expect(yearsOff(2007, 2007)).toBe("spot on");
    expect(missText(q("a", "body"), 300)).toBe("3x too high");
    expect(missText(pct("p", "body"), 65)).toBe("6 too low");
    expect(missText(yr("y", "body"), 2010)).toBe("3 years late");
  });

  // Whatever reads "spot on" scores 100, and nothing else does (UX 21), in every round.
  it("is 100 whenever the miss says spot on, and only then, in every round", () => {
    const cases: [FathomQuestion, number[]][] = [
      [q("a", "body"), Array.from({ length: 41 }, (_, i) => 95 + i * 0.25)],
      [pct("p", "body"), Array.from({ length: 41 }, (_, i) => 66 + i * 0.25)],
      [yr("y", "body"), Array.from({ length: 11 }, (_, i) => 2002 + i)],
    ];
    for (const [question, guesses] of cases) {
      for (const guess of guesses) {
        const spot = missText(question, guess) === "spot on";
        expect(scoreFor(question, guess) === 100, `${roundOf(question)} ${guess}`).toBe(spot);
      }
    }
  });

  it("places the squid by the distance the points come from, its edge at |d| = 1 (30 points; 0 only further out)", () => {
    expect(offAxis("estimate", 200, 100)).toBeCloseTo(Math.log10(2));
    expect(offAxis("estimate", 1, 100)).toBe(-1);
    expect(offAxis("estimate", 1e9, 100)).toBe(1);
    // A percent: powers of ten on the answer's side of 50, higher to the right.
    expect(offAxis("percent", 30, 25)).toBeCloseTo(Math.log10(30 / 25));
    expect(offAxis("percent", 81, 71)).toBeCloseTo(Math.log10(29 / 19));
    expect(offAxis("percent", 61, 71)).toBeCloseTo(Math.log10(29 / 39));
    expect(offAxis("percent", 2.5, 25)).toBeCloseTo(-1);
    expect(offAxis("percent", 0, 25)).toBe(-1);
    expect(offAxis("percent", 0, 71)).toBeCloseTo(Math.log10(29 / 99.5));
    // A year: twice the powers of ten in how long ago, later to the right.
    expect(offAxis("year", 2010, 2007, undefined, NOW)).toBeCloseTo(2 * Math.log10(19 / 16));
    expect(offAxis("year", 1960, 1967, undefined, NOW)).toBeCloseTo(2 * Math.log10(59 / 66));
    expect(offAxis("year", 2017, 2007, undefined, NOW)).toBeCloseTo(2 * Math.log10(19 / 9));
    expect(offAxis("year", 1066, 2007, undefined, NOW)).toBe(-1);
    // A year's edge is about 3.2x off how long ago, where it scores TAIL as 10x off an estimate does; a percent's, 10x
    // off the share or what's left, where its times-off half does, its points-off half still counting.
    const early = 1967 - Math.round(59 * (10 ** (1 / 2) - 1));
    expect(offAxis("year", early, 1967, undefined, NOW)).toBeCloseTo(-1, 1);
    expect(yearScore(early, 1967, NOW)).toBe(TAIL);
    expect(curve(offAxis("percent", 2.5, 25))).toBe(TAIL);
    expect(curve(offAxis("percent", 100 - 2.9, 71))).toBe(TAIL);
    expect(percentScore(2.5, 25)).toBe(Math.round((byPoints(2.5, 25) + TAIL) / 2));
    // The squid's distance is the one the points come from, up to the edge.
    for (const [guess, answer] of [[20, 25], [5, 2.5], [65, 71], [90, 99], [53, 59], [2.5, 25]])
      expect(percentScore(guess, answer), `${guess} for ${answer}`).toBe(
        Math.min(99, Math.round((byPoints(guess, answer) + curve(offAxis("percent", guess, answer))) / 2)),
      );
    for (const [guess, answer] of [[1984, 1967], [2010, 2005], [1880, 1903], [1994, 1997]])
      expect(yearScore(guess, answer, NOW), `${guess} for ${answer}`).toBe(Math.min(99, curve(offAxis("year", guess, answer, undefined, NOW))));
    // Past the edge the squid stays there while the points keep falling, to 0 at 100x off (10x off how long ago).
    expect(offAxis("estimate", 3000, 100)).toBe(1);
    expect([1000, 3000, 10000].map((g) => fathomScore(g, 100))).toEqual([30, 16, 0]);
    expect(offAxis("percent", 0.8, 25)).toBe(-1);
    expect(percentScore(0.8, 25)).toBeLessThan(percentScore(2.5, 25));
  });
});

// The owner's calibration sheet, Nov 8: after "0.8% for 25%" outscored "1984 for 1967", he judged pairs of guesses
// (which one is better, or about the same) and rated a few. Scored with now = 2026, an estimate by its rule and a steps
// list 100 - 30 per step. A pair agrees when the scores are within 15 points, or the one he picked scores higher; a
// rating when the score is in his band (Great 80 and up, Good 45 to 80, Ok 25 to 65, Way off under 25). The old scores
// (100 - 3 a point, 100 - 5 a year) agreed with 6 of his 15 pairs and 2 of his 5 ratings; a first try (a percent by
// times off alone, a year by 3 x log10) with 12 and 5, but he found it too harsh (his notes, at the end). The curve
// 100 x (1 - |d|)^2 agreed with 14 and 4; with its long tail (Nov 14: 10x off scores 30, 100x 0) it agrees with all 15
// pairs (pair 6 now 59 against 49) and the same 4 ratings.
describe("the owner's calibration (Nov 8)", () => {
  type Guess = readonly ["percent" | "year" | "estimate" | "steps", number, number];
  const points = ([round, guess, answer]: Guess): number =>
    round === "percent"
      ? percentScore(guess, answer)
      : round === "year"
        ? yearScore(guess, answer, NOW)
        : round === "steps"
          ? stepsScore(guess, answer)
          : fathomScore(guess, answer);
  const agrees = (a: number, b: number, pick: "A" | "B" | "Same") =>
    Math.abs(a - b) <= 15 || (pick === "A" && a > b) || (pick === "B" && b > a);
  const PAIRS: readonly [number, Guess, Guess, "A" | "B" | "Same"][] = [
    [1, ["percent", 0.8, 25], ["year", 1984, 1967], "B"],
    [2, ["percent", 10, 2.5], ["year", 1940, 1903], "Same"],
    [3, ["percent", 1, 10], ["estimate", 500, 330], "B"],
    [4, ["percent", 40, 60], ["year", 1960, 1928], "Same"],
    [5, ["percent", 50, 74], ["year", 1975, 1953], "B"],
    [6, ["year", 2000, 1992], ["estimate", 20, 8.8], "Same"],
    [7, ["year", 1990, 1971], ["estimate", 100, 206], "Same"],
    [8, ["percent", 15, 32], ["year", 2010, 2005], "Same"],
    [9, ["percent", 50, 59], ["estimate", 80, 104], "A"],
    [10, ["year", 1950, 1967], ["year", 1984, 1967], "Same"],
    [11, ["percent", 1, 2.5], ["percent", 5, 2.5], "Same"],
    [12, ["estimate", 150, 330], ["estimate", 700, 330], "Same"],
    [13, ["estimate", 123, 50], ["estimate", 18, 50], "Same"],
    [14, ["steps", 4, 6], ["steps", 9, 6], "A"],
    [15, ["estimate", 84, 50], ["year", 1985, 1992], "Same"],
  ];
  // No known misses since the long tail (Nov 14). Before it, pair 6: year 2000 for 1992 scored 59, estimate 20 for 8.8
  // 41 (2.3x off), where he said the same; the tail lifts 2.3x off to 49.
  for (const [n, a, b, pick] of PAIRS) {
    it(`pair ${n}: ${a.join(" ")} against ${b.join(" ")}, he said ${pick}`, () => {
      const [pa, pb] = [points(a), points(b)];
      expect(agrees(pa, pb, pick), `${pa} against ${pb}`).toBe(true);
    });
  }

  it("agrees with all 15 of his pairs", () => {
    const agreed = PAIRS.filter(([, a, b, pick]) => agrees(points(a), points(b), pick));
    expect(agreed.length).toBe(15);
  });

  // What he played: the beetles' share now scores below the heart transplant's year.
  it("scores 0.8% for 25% below 1984 for 1967", () => {
    expect(points(["percent", 0.8, 25])).toBe(21);
    expect(points(["year", 1984, 1967])).toBe(51);
  });

  const BANDS = { Great: [80, 100], Good: [45, 80], Ok: [25, 65], "Way off": [0, 24] } as const;
  const RATINGS: readonly [Guess, keyof typeof BANDS][] = [
    [["year", 1984, 1967], "Ok"],
    [["percent", 20, 25], "Great"],
    [["percent", 5, 2.5], "Good"],
    [["estimate", 250, 330], "Good"],
  ];
  // Known miss: year 1880 for 1903, his "Ok" (25 to 65), scores 72. It is 1.19x off how long ago (d 0.15), where the
  // curve is as it was: lowering it to 65 would take 250 for 330 (d 0.12, his Good, 77) and 20 for 25 (d 0.10, his
  // Great, 84) down with it.
  for (const [guess, band] of RATINGS) {
    it(`rates ${guess.join(" ")} ${band}`, () => {
      const [lo, hi] = BANDS[band];
      const p = points(guess);
      expect(p >= lo && p <= hi, `${p} is not ${band} (${lo} to ${hi})`).toBe(true);
    });
  }

  // His notes on the first try: "i would give some points for 0.8, not 0, 2.5 for 5 isnt that bad id give 60-75 points".
  it("gives 0.8% for 25% some points, under 25", () => {
    const p = points(["percent", 0.8, 25]);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(25);
  });
  it("gives 5% for 2.5% 60 to 75", () => {
    const p = points(["percent", 5, 2.5]);
    expect(p).toBeGreaterThanOrEqual(60);
    expect(p).toBeLessThanOrEqual(75);
  });
  // Nov 14, on 30,000 years for Homo sapiens (300,000 years ago, asked as an estimate): "shouldn't get 0 points for this
  // we were within one magnitude should get more like 25-40 points".
  it("gives 10x off 25 to 40, either way", () => {
    for (const guess of [30000, 3000000]) {
      const p = points(["estimate", guess, 300000]);
      expect(p).toBeGreaterThanOrEqual(25);
      expect(p).toBeLessThanOrEqual(40);
    }
  });
});

describe("reading a guess, by round", () => {
  const percent = pct("p", "body");
  const year = yr("y", "body");
  const value = (text: string, question: FathomQuestion) => {
    const r = readGuess(text, question);
    return "value" in r ? r.value : r.error;
  };
  it("reads a percent typed as 71, 71%, 71.5 or 71 percent, from 0 to 100", () => {
    expect(value("71", percent)).toBe(71);
    expect(value("71%", percent)).toBe(71);
    expect(value("71 %", percent)).toBe(71);
    expect(value("71.5", percent)).toBe(71.5);
    expect(value("71,5", percent)).toBe(71.5);
    expect(value("71 percent", percent)).toBe(71);
    expect(value("71 per cent", percent)).toBe(71);
    expect(value("about 70", percent)).toBe(70);
    // Zero is a fair guess at a share; past 100 or below 0 isn't one.
    expect(value("0", percent)).toBe(0);
    expect(value("0%", percent)).toBe(0);
    expect(value("100", percent)).toBe(100);
    expect(value("100.5", percent)).toBe("range");
    expect(value("150", percent)).toBe("range");
    expect(value("-5", percent)).toBe("range");
    expect(value("", percent)).toBe("empty");
    expect(value("abc", percent)).toBe("text");
    expect(value("71 kg", percent)).toBe("unit");
  });
  it("reads a year as typed, a whole AD year of up to four digits", () => {
    expect(value("2007", year)).toBe(2007);
    expect(value(" 2007 ", year)).toBe(2007);
    expect(value("2007 AD", year)).toBe(2007);
    expect(value("AD 2007", year)).toBe(2007);
    expect(value("2007 CE", year)).toBe(2007);
    expect(value("about 1900", year)).toBe(1900);
    expect(value("c. 1900", year)).toBe(1900);
    expect(value("1,969", year)).toBe(1969);
    expect(value("800", year)).toBe(800);
    expect(value("2007.5", year)).toBe("whole");
    expect(value("10000", year)).toBe("range");
    expect(value("2.5m", year)).toBe("range");
    expect(value("0", year)).toBe("zero");
    expect(value("-500", year)).toBe("negative");
    expect(value("", year)).toBe("empty");
    expect(value("abc", year)).toBe("text");
    expect(value("1969 years", year)).toBe("text");
  });
  it("reads an estimate as before", () => {
    expect(readGuess("8,800,000", q("c", "places", { unit: "million people", answer: 8.8 }))).toEqual({ value: 8.8, converted: true });
    expect(readGuess("0", q("a", "body"))).toEqual({ error: "zero" });
  });
  it("says what's wrong in the round's own words, each short enough for one line at 320px", () => {
    expect(guessError("range", percent)).toBe("0 to 100, please.");
    expect(guessError("whole", year)).toBe("A whole year, please.");
    expect(guessError("range", year)).toBe("A year has four digits.");
    expect(guessError("text", year)).toBe("That doesn't read as a year.");
    expect(guessError("empty", year)).toBe("Type a year first.");
    expect(guessError("text", percent)).toBe("That doesn't read as a number.");
    expect(guessError("unit", percent)).toBe("In percent, please.");
    expect(guessError("unit", q("a", "body", { unit: "centimetres" }))).toBe("In centimetres, please.");
    expect(guessError("negative", q("a", "body"))).toBe("No negatives. It's above zero.");
    // "That doesn't read as a number." is the longest one the 320px echo already fits.
    for (const question of [q("a", "body"), percent, year])
      for (const e of ["empty", "zero", "negative", "text", "range", "whole"] as const)
        expect(guessError(e, question).length, `${roundOf(question)} ${e}`).toBeLessThanOrEqual(30);
  });
});

describe("showing a number, by round", () => {
  it("shows an estimate with its unit, a percent with %, a year as typed (never 2,007)", () => {
    expect(amountText(q("c", "places", { unit: "million people" }), 8.8)).toBe("8.8 million people");
    expect(amountText(q("a", "body", { unit: "metres" }), 8848.86)).toBe("8,849 metres");
    expect(amountText(pct("p", "body"), 71)).toBe("71%");
    expect(amountText(pct("p", "body"), 71.5)).toBe("71.5%");
    expect(amountText(pct("p", "body"), 0)).toBe("0%");
    expect(amountText(yr("y", "body"), 2007)).toBe("2007");
    expect(amountText(yr("y", "body"), 800)).toBe("800");
    expect(figureParts(q("a", "body", { unit: "metres" }), 330)).toEqual({ n: "330", unit: "metres" });
    expect(figureParts(pct("p", "body"), 71)).toEqual({ n: "71%" });
    expect(figureParts(yr("y", "body"), 2007)).toEqual({ n: "2007" });
    // Beside the field: the unit, a percent's sign.
    expect(unitShown(q("a", "body", { unit: "metres" }))).toBe("metres");
    expect(unitShown(pct("p", "body"))).toBe("%");
    expect(unitShown(yr("y", "body"))).toBe("year");
  });
  it("never groups a year's digits as it's typed", () => {
    expect(type([..."2007"], undefined, "year")).toEqual({ text: "2007", caret: 4 });
    expect(type([..."2007"])).toEqual({ text: "2,007", caret: 5 });
    expect(type([..."71"], undefined, "percent").text).toBe("71");
  });
  it("says how real players guessed in the round's own terms", () => {
    expect(playersLine({ n: 25, median: 1969.4, furtherOff: 0.5 }, "year", "year")).toBe("Players' typical guess: 1969 · you were closer than 50%");
    expect(playersLine({ n: 25, median: 64.25, furtherOff: 0.5 }, "percent", "percent")).toBe("Players' typical guess: 64.3% · you were closer than 50%");
  });
});

// The owner: "Too many are how much does xx weigh, how tall is xx." At most two of those a game.
describe("how tall / how heavy questions", () => {
  const ask = (question: string, unit: string, extra: Partial<FathomQuestion> = {}) => isSizeQuestion({ question, unit, ...extra });
  it("are estimates in a length or a mass that ask how big or heavy a thing is", () => {
    expect(ask("How tall is the Eiffel Tower?", "metres")).toBe(true);
    expect(ask("How long is a marathon?", "kilometres")).toBe(true);
    expect(ask("How high is a basketball hoop?", "metres")).toBe(true);
    expect(ask("How deep is Lake Baikal, the world's deepest lake?", "metres")).toBe(true);
    expect(ask("How wide is an adult human eyeball?", "millimetres")).toBe(true);
    expect(ask("How much does an ostrich egg weigh?", "kilograms")).toBe(true);
    expect(ask("How much can a single jackfruit weigh?", "kilograms")).toBe(true);
    expect(ask("What weight of tomatoes was thrown at Spain's La Tomatina festival?", "tonnes")).toBe(true);
    expect(ask("How heavy is a giraffe?", "tonnes")).toBe(true);
  });
  it("aren't distances, amounts, durations, counts or other rounds", () => {
    expect(ask("How far away is the Moon?", "kilometres")).toBe(false);
    expect(ask("How far does an Arctic tern fly in a year?", "kilometres")).toBe(false);
    expect(ask("How much tea does Turkey get through per person each year?", "kilograms")).toBe(false);
    expect(ask("How much can the fastest-growing bamboo grow in one day?", "centimetres")).toBe(false);
    expect(ask("How long does sunlight take to reach Earth?", "minutes")).toBe(false);
    expect(ask("How long is a year on Mars?", "days")).toBe(false);
    expect(ask("How much blood is in a typical adult's body?", "litres")).toBe(false);
    expect(ask("How many bones are in an adult human skeleton?", "bones")).toBe(false);
    expect(ask("What is the area of Vatican City?", "square kilometres")).toBe(false);
    expect(ask("How tall is the Eiffel Tower?", "percent", { round: "percent" })).toBe(false);
  });
});

describe("real players on the reveal", () => {
  // The owner: real players instead of a judge's estimate, once there are enough of them; below that, nothing.
  it(`says how they guessed from ${MIN_PLAYERS} players on, and nothing below`, () => {
    expect(MIN_PLAYERS).toBe(20);
    expect(playersLine({ n: 20, median: 4, furtherOff: 0.72 }, "litres")).toBe("Players' typical guess: 4 litres · you were closer than 72%");
    expect(playersLine({ n: 1203, median: 2.5e6, furtherOff: 0.29 }, "people")).toBe("Players' typical guess: 2.5 million people · you were closer than 29%");
    // Rounded down: 100% is everyone.
    expect(playersLine({ n: 40, median: 330, furtherOff: 0.996 }, "metres")).toBe("Players' typical guess: 330 metres · you were closer than 99%");
    expect(playersLine({ n: 19, median: 4, furtherOff: 0.72 }, "litres")).toBeNull();
    expect(playersLine({ n: 30, median: null, furtherOff: null }, "litres")).toBeNull();
    expect(playersLine(null, "litres")).toBeNull();
  });
});

describe("bands", () => {
  it("cut at 90, 70, 40 and 15", () => {
    expect([100, 90, 89, 70, 69, 40, 39, 15, 14, 0].map(bandOf)).toEqual([
      "dead-on",
      "dead-on",
      "close",
      "close",
      "near",
      "near",
      "far",
      "far",
      "lost",
      "lost",
    ]);
  });
  it("have plain names", () => {
    expect(["dead-on", "close", "near", "far", "lost"].map((b) => bandLabel(b as never))).toEqual([
      "Dead on",
      "Close",
      "Near",
      "Far",
      "Lost at sea",
    ]);
  });
});

// The owner: plain words for the miss. A percent within 2x ("30% low"), times beyond it ("3x too high").
describe("the miss in plain words", () => {
  it("says how many percent low or high within 2x", () => {
    expect(timesOff(70, 100)).toBe("30% low");
    expect(timesOff(120, 100)).toBe("20% high");
    expect(timesOff(130, 100)).toBe("30% high");
    expect(timesOff(334, 330)).toBe("1% high");
    expect(timesOff(51, 100)).toBe("49% low");
    expect(timesOff(199, 100)).toBe("99% high");
  });
  it("says how many times too high or too low from 2x", () => {
    expect(timesOff(200, 100)).toBe("2x too high");
    expect(timesOff(50, 100)).toBe("2x too low");
    // Not "100% high": a percent that rounds to 100 is twice the answer.
    expect(timesOff(199.6, 100)).toBe("2x too high");
    expect(timesOff(300, 100)).toBe("3x too high");
    expect(timesOff(25, 100)).toBe("4x too low");
    expect(timesOff(100, 240)).toBe("2.4x too low");
    expect(timesOff(1200, 100)).toBe("12x too high");
    expect(timesOff(150000, 100)).toBe("1,500x too high");
    expect(timesOff(1, 3e6)).toBe("3 million times too low");
  });
  it("is spot on within 1%", () => {
    expect(timesOff(330, 330)).toBe("spot on");
    expect(timesOff(333, 330)).toBe("spot on");
    expect(timesOff(327, 330)).toBe("spot on");
  });
});

describe("reading numbers", () => {
  it("reads plain numbers, separators and decimals", () => {
    expect(parseNumber("330")).toBe(330);
    expect(parseNumber("2,500,000")).toBe(2_500_000);
    expect(parseNumber("2 500 000")).toBe(2_500_000);
    expect(parseNumber("2.500.000")).toBe(2_500_000);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("0.1")).toBe(0.1);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber(" 12 ")).toBe(12);
    expect(parseNumber("2.5e6")).toBe(2_500_000);
  });
  it("reads a decimal comma that can't be a thousands separator", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1,5 million")).toBe(1_500_000);
    expect(parseNumber("1,000")).toBe(1000);
  });
  it("reads short forms and words", () => {
    expect(parseNumber("2.5m")).toBe(2_500_000);
    expect(parseNumber("2.5 million")).toBe(2_500_000);
    expect(parseNumber("2.5M")).toBe(2_500_000);
    expect(parseNumber("2.5million")).toBe(2_500_000);
    expect(parseNumber("1.5bn")).toBe(1_500_000_000);
    expect(parseNumber("1.5 billion")).toBe(1_500_000_000);
    expect(parseNumber("1.5b")).toBe(1_500_000_000);
    expect(parseNumber("3k")).toBe(3000);
    expect(parseNumber("3 thousand")).toBe(3000);
    expect(parseNumber("4 hundred")).toBe(400);
    expect(parseNumber("2 trillion")).toBe(2e12);
    expect(parseNumber("about 300")).toBe(300);
    expect(parseNumber("~300")).toBe(300);
  });
  it("reads the question's unit after the number as the unit, not a multiplier", () => {
    expect(parseNumber("330m", "metres")).toBe(330);
    expect(parseNumber("330 m", "metres")).toBe(330);
    expect(parseNumber("330 metres", "metres")).toBe(330);
    expect(parseNumber("330 meters", "metres")).toBe(330);
    expect(parseNumber("2.5 million", "metres")).toBe(2_500_000);
    expect(parseNumber("2.5 million m", "metres")).toBe(2_500_000);
    expect(parseNumber("2t", "tonnes")).toBe(2);
    expect(parseNumber("384k km", "kilometres")).toBe(384_000);
    expect(parseNumber("8 billion people", "people")).toBe(8e9);
    expect(parseNumber("15°C", "degrees Celsius")).toBe(15);
    expect(parseNumber("86400 s", "seconds")).toBe(86400);
    // Without the unit, m is a million.
    expect(parseNumber("330m", "people")).toBe(330_000_000);
    // Only a whole unit word comes off: "2.5mm" is 2.5 millimetres, not "2.5m" with its "m" taken off.
    expect(parseNumber("2.5mm", "metres")).toBe(0.0025);
  });
  // Nov 5 review: "343 m/s" and "390000 km2" were refused on questions in those units.
  it("reads every form of the question's own unit", () => {
    expect(parseNumber("343 m/s", "metres per second")).toBe(343);
    expect(parseNumber("343m/s", "metres per second")).toBe(343);
    expect(parseNumber("343 metres per second", "metres per second")).toBe(343);
    expect(parseNumber("390000 km2", "square kilometres")).toBe(390_000);
    expect(parseNumber("390000km²", "square kilometres")).toBe(390_000);
    expect(parseNumber("390,000 sq km", "square kilometres")).toBe(390_000);
    expect(parseNumber("390k km2", "square kilometres")).toBe(390_000);
    expect(parseNumber("485 °C", "degrees Celsius")).toBe(485);
    expect(parseNumber("12 people", "people")).toBe(12);
    expect(parseNumber("206 bones", "bones")).toBe(206);
    expect(parseNumber("1 bone", "bones")).toBe(1);
  });
  // Nov 5 review: "0.5m" on a question in centimetres read 500,000 cm, "8m" in minutes 8 million, "150t" in kilograms
  // 150 trillion. A unit of the question's kind is a unit, never a scale word.
  it("never reads a unit of the question's kind as a scale word", () => {
    expect(parseNumber("0.5m", "centimetres")).toBe(50);
    expect(parseNumber("8m", "minutes")).toBe(8);
    expect(parseNumber("150t", "kilograms")).toBe(150_000);
    // Elsewhere they are still a million and a trillion.
    expect(parseNumber("8m", "people")).toBe(8_000_000);
    expect(parseNumber("3t", "trees")).toBe(3e12);
  });
  it("converts another unit of the same kind exactly", () => {
    // Length.
    expect(parseNumber("1.5 km", "metres")).toBe(1500);
    expect(parseNumber("45cm", "metres")).toBe(0.45);
    expect(parseNumber("450 mm", "centimetres")).toBe(45);
    expect(parseNumber("8.56 cm", "millimetres")).toBe(85.6);
    expect(parseNumber("384,400,000 m", "kilometres")).toBe(384_400);
    expect(parseNumber("2.72 metres", "centimetres")).toBe(272);
    // Time.
    expect(parseNumber("2 h", "minutes")).toBe(120);
    expect(parseNumber("1.5 hours", "minutes")).toBe(90);
    expect(parseNumber("498 s", "minutes")).toBe(8.3);
    expect(parseNumber("660 min", "hours")).toBe(11);
    expect(parseNumber("5832 hours", "days")).toBe(243);
    expect(parseNumber("2 years", "months")).toBe(24);
    // Mass.
    expect(parseNumber("38000 g", "kilograms")).toBe(38);
    expect(parseNumber("0.038 t", "kilograms")).toBe(38);
    expect(parseNumber("145 tonnes", "kilograms")).toBe(145_000);
    expect(parseNumber("6 kg", "grams")).toBe(6000);
    // Speed, area, volume.
    expect(parseNumber("1234.8 km/h", "metres per second")).toBe(343);
    expect(parseNumber("49 ha", "square kilometres")).toBe(0.49);
    expect(parseNumber("500 ml", "litres")).toBe(0.5);
    expect(parseNumber("2500 m3", "litres")).toBe(2_500_000);
    // A scale word and a unit together.
    expect(parseNumber("1.2 million km", "metres")).toBe(1.2e9);
    // Says it was converted, so the echo can name the unit.
    expect(readNumber("0.5m", "centimetres")).toEqual({ value: 50, converted: true });
    expect(readNumber("50 cm", "centimetres")).toEqual({ value: 50 });
  });
  // Nov 5 (owner): the scale keys went, and big counts are asked in a unit with a scale word, so the player types a
  // short number ("8.8" million people). One typed as the whole amount, with a scale word, a unit or just all its
  // digits, is taken back to the unit's scale, not read as millions of millions.
  it("reads a unit with a scale word", () => {
    expect(readNumber("8.8", "million people")).toEqual({ value: 8.8 });
    expect(readNumber("8,800,000", "million people")).toEqual({ value: 8.8, converted: true });
    expect(parseNumber("8.8 million", "million people")).toBe(8.8);
    expect(parseNumber("8.8m", "million people")).toBe(8.8);
    expect(parseNumber("8.8 million people", "million people")).toBe(8.8);
    expect(parseNumber("8,804,190 people", "million people")).toBe(8.80419);
    expect(parseNumber("8800 thousand", "million people")).toBe(8.8);
    expect(parseNumber("26.5", "billion chickens")).toBe(26.5);
    expect(parseNumber("26.5 billion", "billion chickens")).toBe(26.5);
    expect(parseNumber("26.5bn", "billion chickens")).toBe(26.5);
    expect(parseNumber("26,500,000,000", "billion chickens")).toBe(26.5);
    expect(parseNumber("3040", "billion trees")).toBe(3040);
    expect(parseNumber("3 trillion", "billion trees")).toBe(3000);
    expect(parseNumber("2.5", "million litres")).toBe(2.5);
    expect(parseNumber("2.5m", "million litres")).toBe(2.5);
    expect(parseNumber("2500 m3", "million litres")).toBe(2.5);
    expect(parseNumber("2,500,000 litres", "million litres")).toBe(2.5);
    // Under the scale and nothing typed after it: in the unit, whatever its size.
    expect(parseNumber("950000", "million people")).toBe(950_000);
    expect(readNumber("5 kg", "million people")).toEqual({ error: "unit" });
    expect(askFor("million people")).toBe("In million people, please.");
    expect(askFor("million litres")).toBe("In million litres, please.");
  });
  // A new question in a unit the table doesn't know would be refused when typed with its unit: every question in the
  // bank reads its own answer back, typed with its unit.
  it("reads every question's answer typed with its own unit", () => {
    const bank = readBank(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "public", "fathom", "questions.json"), "utf8")))!;
    expect(bank.length).toBeGreaterThan(0);
    for (const q of bank) {
      expect(parseNumber(`${q.answer} ${q.unit}`, q.unit), `${q.id}: "${q.answer} ${q.unit}"`).toBe(q.answer);
      expect(parseNumber(`${q.answer}${q.unit}`, q.unit), `${q.id}: "${q.answer}${q.unit}"`).toBe(q.answer);
      // As its round reads a guess, typed bare and, for a percent or a year, as the reveal shows it ("20.95%", "1903"; an
      // estimate's shows rounded past a thousand): full marks.
      for (const typed of [String(q.answer), ...(roundOf(q) === "estimate" ? [] : [amountText(q, q.answer)])]) {
        expect(readGuess(typed, q), `${q.id}: "${typed}"`).toMatchObject({ value: q.answer });
        expect(scoreFor(q, q.answer), q.id).toBe(100);
      }
    }
    expect(bank.some((q) => roundOf(q) === "percent") && bank.some((q) => roundOf(q) === "year"), "the bank plays every round").toBe(true);
  });
  // Nov 5 review: "343 km/h" on a question in metres per second said "That doesn't read as a number."
  it("asks for the question's unit when the one typed can't be converted", () => {
    expect(readNumber("767 mph", "metres per second")).toEqual({ error: "unit" });
    expect(readNumber("1000 ft", "metres")).toEqual({ error: "unit" });
    expect(readNumber("1000 feet", "metres")).toEqual({ error: "unit" });
    expect(readNumber("900 °F", "degrees Celsius")).toEqual({ error: "unit" });
    expect(readNumber("84 lbs", "kilograms")).toEqual({ error: "unit" });
    expect(readNumber("3 weeks", "months")).toEqual({ error: "unit" });
    expect(readNumber("343 km", "metres per second")).toEqual({ error: "unit" });
    expect(readNumber("5 kg", "metres")).toEqual({ error: "unit" });
    expect(readNumber("5 kg", "bones")).toEqual({ error: "unit" });
    expect(readNumber("90 minutes", "litres")).toEqual({ error: "unit" });
    // A word that is no unit at all still doesn't read as a number.
    expect(readNumber("12 apples", "bones")).toEqual({ error: "text" });
    expect(askFor("centimetres")).toBe("In centimetres, please.");
    expect(askFor("degrees Celsius")).toBe("In degrees Celsius, please.");
    expect(askFor("bones")).toBe("Just the number of bones.");
  });
  it("says what's wrong", () => {
    expect(readNumber("")).toEqual({ error: "empty" });
    expect(readNumber("   ")).toEqual({ error: "empty" });
    expect(readNumber("0")).toEqual({ error: "zero" });
    expect(readNumber("0.0")).toEqual({ error: "zero" });
    expect(readNumber("0k")).toEqual({ error: "zero" });
    expect(readNumber("-5")).toEqual({ error: "negative" });
    expect(readNumber("−5")).toEqual({ error: "negative" });
    expect(readNumber("abc")).toEqual({ error: "text" });
    expect(readNumber("twelve")).toEqual({ error: "text" });
    expect(readNumber("12 apples")).toEqual({ error: "text" });
    expect(readNumber("1/2")).toEqual({ error: "text" });
    expect(readNumber("1.2.3")).toEqual({ error: "text" });
    expect(readNumber("1e999")).toEqual({ error: "text" });
    expect(readNumber("m")).toEqual({ error: "text" });
  });
  it("rejects empty, zero, negatives and text", () => {
    for (const bad of ["", "0", "-3", "-2.5m", "abc", "three", "2..5", "k"]) expect(parseNumber(bad)).toBeNull();
  });
});

/** Types `keys` into the field one at a time at the caret (Backspace deletes before it), as editField sees it. */
function type(keys: string[], start = { text: "", caret: 0 }, round?: Round) {
  let f = start;
  for (const k of keys) {
    const next = k === "Backspace" ? f.text.slice(0, f.caret - 1) + f.text.slice(f.caret) : f.text.slice(0, f.caret) + k + f.text.slice(f.caret);
    f = editField(f.text, next, k === "Backspace" ? f.caret - 1 : f.caret + k.length, round);
  }
  return f;
}

// Nov 5 (owner): no scale keys, "just have them type the number": the field groups it as it's typed.
describe("the field", () => {
  it("groups the digits before the point", () => {
    expect(groupDigits("8800000")).toBe("8,800,000");
    expect(groupDigits("1234.5678")).toBe("1,234.5678");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("2500000 km")).toBe("2,500,000 km");
    expect(groupDigits("")).toBe("");
    expect(groupDigits("about 3000")).toBe("about 3000");
    expect(groupDigits("2.5e6")).toBe("2.5e6");
    expect(groupDigits("12345e3")).toBe("12345e3");
  });
  it("groups as each digit is typed, the caret after it", () => {
    expect(type([..."8800000"])).toEqual({ text: "8,800,000", caret: 9 });
    expect(type([..."384400.5"])).toEqual({ text: "384,400.5", caret: 9 });
    // Pasted whole.
    expect(editField("", "8800000", 7)).toEqual({ text: "8,800,000", caret: 9 });
  });
  it("keeps the caret after the same digit in the middle", () => {
    // "1,|234" and a 9: "19,|234" (after the 9, before the comma).
    expect(type(["9"], { text: "1,234", caret: 2 })).toEqual({ text: "19,234", caret: 2 });
    // "12,|345" and a 9: "129|,345".
    expect(type(["9"], { text: "12,345", caret: 3 })).toEqual({ text: "129,345", caret: 3 });
    // Deleting at the end: "1,234|" to "123|".
    expect(type(["Backspace"], { text: "1,234", caret: 5 })).toEqual({ text: "123", caret: 3 });
    // Deleting the field's own comma deletes nothing: the caret steps back over it.
    expect(type(["Backspace"], { text: "1,234", caret: 2 })).toEqual({ text: "1,234", caret: 1 });
  });
  it("leaves a comma the player typed as typed, so a decimal comma reads", () => {
    const comma = type([..."2,5"]);
    expect(comma.text).toBe("2,5");
    expect(parseNumber(comma.text)).toBe(2.5);
    // Habit: "8,800,000" typed with its commas.
    expect(type([..."8,800,000"]).text).toBe("8,800,000");
    expect(parseNumber(type([..."8,800,000"]).text)).toBe(8_800_000);
    // The player's comma gone, the field groups again.
    expect(type(["Backspace", "Backspace", ..."5000"], comma)).toEqual({ text: "25,000", caret: 6 });
  });
});

describe("formatting", () => {
  it("keeps digits clean of float noise", () => {
    expect(formatDigits(1.1 * 1000)).toBe("1,100");
    expect(formatDigits(8848.86)).toBe("8,848.86");
    expect(formatDigits(0.0001)).toBe("0.0001");
  });
  it("words round to four significant digits", () => {
    expect(formatWords(149_597_870)).toBe("149.6 million");
    expect(formatWords(12_346)).toBe("12.35 thousand");
    expect(formatWords(999_999)).toBe("1 million");
    expect(formatWords(999e12)).toBe("999 trillion");
    expect(formatWords(5e15)).toBe("5e15");
    expect(formatWords(3.14159e20)).toBe("3.142e20");
    expect(formatWords(42)).toBe("42");
  });
  it("shows amounts in digits up to a million, words from there", () => {
    expect(formatAmount(384_400)).toBe("384,400");
    // An answer past a thousand shows whole units: the speed of light is 299,792 km/s, not 299,792.458.
    expect(formatAmount(299_792.458)).toBe("299,792");
    expect(formatAmount(8848.86)).toBe("8,849");
    expect(formatAmount(8.3)).toBe("8.3");
    expect(formatAmount(8.1e9)).toBe("8.1 billion");
  });
});

describe("the bank", () => {
  it("keeps well-formed questions and drops the rest", () => {
    const good = q("a", "body", { definition: "in an adult", easy: true });
    const bank = readBank({
      version: 1,
      questions: [
        good,
        { ...q("b", "food"), kind: "weather" },
        { ...q("c", "food"), answer: 0 },
        { ...q("e", "food"), source: { title: "x" } },
        { ...q("f", "food"), unit: "" },
        q("a", "animals"),
        null,
      ],
    });
    expect(bank).toEqual([good]);
  });
  // The judge's typical miss stays in the file for the writers; the game no longer reads it, or needs it.
  it("keeps a question with or without a typical miss, and leaves that out of what it reads", () => {
    const bank = readBank({ version: 1, questions: [{ ...q("a", "body"), typical: 2 }, q("b", "food"), { ...q("c", "food"), typical: "?" }] });
    expect(bank).toEqual([q("a", "body"), q("b", "food"), q("c", "food")]);
  });
  it("is null when the file isn't a bank", () => {
    expect(readBank(null)).toBeNull();
    expect(readBank("<!doctype html>")).toBeNull();
    expect(readBank({ version: 1 })).toBeNull();
  });
  // A round the game can't play, or an answer outside its round's range, is left out rather than played wrong.
  it("keeps a question's round, and leaves out one it can't play", () => {
    const good = [pct("p", "body", { answer: 100 }), yr("y", "food", { answer: 1889 }), { ...q("e", "space"), round: "estimate" as const }];
    const bank = readBank({
      version: 1,
      questions: [
        ...good,
        { ...q("n", "space"), round: "name" },
        pct("p1", "body", { answer: 101 }),
        yr("y1", "body", { answer: 1889.5 }),
        yr("y2", "body", { answer: 12000 }),
      ],
    });
    expect(bank).toEqual(good);
  });
});

/** Twelve questions, one of each kind, three of them easy. */
const KINDS: FathomKind[] = ["body", "animals", "landmarks", "places", "space", "food", "everyday", "nature", "science", "sports", "culture", "lists"];
const BANK = KINDS.map((kind, i) => q(`q${i}`, kind, { easy: i % 4 === 0 }));

describe("the draw", () => {
  it("draws five, no two of a kind, the first one easy", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const drawn = drawQuestions(BANK, [], seeded(seed));
      expect(drawn).toHaveLength(5);
      expect(new Set(drawn.map((d) => d.kind)).size).toBe(5);
      expect(drawn[0].easy).toBe(true);
    }
  });
  it("holds back the last three games' questions while the bank allows", () => {
    // Three of each kind: with three games (15 questions) held back, at least seven kinds still have a fresh one.
    const bank = [0, 1, 2].flatMap((n) => KINDS.map((kind, i) => q(`${n}-${i}`, kind, { easy: true })));
    const rand = seeded(7);
    let recent: string[][] = [];
    for (let game = 0; game < 8; game++) {
      const ids = drawQuestions(bank, recent, rand).map((d) => d.id);
      expect(ids.filter((id) => recent.flat().includes(id))).toEqual([]);
      recent = [ids, ...recent].slice(0, 3);
    }
  });
  it("brings back the oldest held-back questions first when it must", () => {
    const bank = BANK.slice(0, 7).map((x) => ({ ...x, easy: true }));
    const recent = [["q0", "q1", "q2"], ["q3", "q4"], ["q5"]];
    const ids = drawQuestions(bank, recent, seeded(3)).map((d) => d.id);
    // q6 (never played) first, then q5 (three games ago) and q3, q4 (two ago), and one from the last game.
    expect(ids[0]).toBe("q6");
    expect(ids.filter((id) => ["q3", "q4", "q5", "q6"].includes(id)).sort()).toEqual(["q3", "q4", "q5", "q6"]);
    expect(ids.filter((id) => ["q0", "q1", "q2"].includes(id))).toHaveLength(1);
  });
  it("prefers an easy question for the first, even a recent one", () => {
    const bank = BANK.map((x) => ({ ...x, easy: x.id === "q4" }));
    const drawn = drawQuestions(bank, [["q4"]], seeded(5));
    expect(drawn[0].id).toBe("q4");
  });
  it("repeats a kind rather than come up short, and copes with no easy question", () => {
    const bank = [q("a", "food"), q("b", "food"), q("c", "food"), q("d", "body"), q("e", "body")];
    const drawn = drawQuestions(bank, [], seeded(9));
    expect(drawn.map((d) => d.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    // Kinds repeat only once the bank runs out of others: with a third kind, all three are in.
    const wider = [...bank, q("f", "space")];
    for (let seed = 1; seed <= 50; seed++) expect(new Set(drawQuestions(wider, [], seeded(seed)).map((d) => d.kind)).size).toBe(3);
  });
  it("is random", () => {
    const firsts = new Set(Array.from({ length: 60 }, (_, s) => drawQuestions(BANK, [], seeded(s + 1)).map((d) => d.id).join()));
    expect(firsts.size).toBeGreaterThan(30);
  });
});

/**
 * A bank with every round: an estimate, two percent and two year questions of each kind (the kinds shifted, so a round
 * doesn't keep to one kind), a third of them easy, and half the estimates how tall / how heavy questions.
 */
const MIXED = KINDS.flatMap((kind, i) => [
  q(`e${i}`, kind, { easy: i % 3 === 0, ...(i % 2 === 0 && { question: `How tall is thing ${i}?`, unit: "metres" }) }),
  q(`f${i}`, kind, { ...(i % 2 === 1 && { question: `How much does thing ${i} weigh?`, unit: "kilograms" }) }),
  pct(`p${i}`, KINDS[(i + 1) % 12], { easy: i % 4 === 0 }),
  yr(`y${i}`, KINDS[(i + 2) % 12], { easy: i % 4 === 1 }),
]);

// The owner's revamp plan: five rounds a game, two estimates, a percent, a year, and a name-it round (another estimate
// when the bank has none); a mixed order with an easy one first; at most two how tall / how heavy.
describe("the game's shape", () => {
  const rounds = (drawn: FathomQuestion[]) => drawn.map(roundOf);
  const count = (drawn: FathomQuestion[], round: Round) => rounds(drawn).filter((r) => r === round).length;

  it("is two estimates, a percent, a year, and a fifth that is an estimate while the bank has no name-it round", () => {
    expect(GAME_ROUNDS).toEqual(["estimate", "estimate", "percent", "year", "name"]);
    for (let seed = 1; seed <= 200; seed++) {
      const drawn = drawQuestions(MIXED, [], seeded(seed));
      expect(drawn).toHaveLength(5);
      expect([count(drawn, "estimate"), count(drawn, "percent"), count(drawn, "year")], `seed ${seed}`).toEqual([3, 1, 1]);
      expect(drawn[0].easy, `seed ${seed}`).toBe(true);
      expect(new Set(drawn.map((d) => d.kind)).size, `seed ${seed}: five kinds`).toBe(5);
    }
  });
  it("mixes the order: the percent and the year turn up anywhere after the first", () => {
    const at = (round: Round) => new Set(Array.from({ length: 200 }, (_, s) => rounds(drawQuestions(MIXED, [], seeded(s + 1))).indexOf(round)));
    for (const round of ["percent", "year"] as const) for (const i of [1, 2, 3, 4]) expect(at(round).has(i), `${round} at ${i}`).toBe(true);
  });
  it(`has at most ${MAX_SIZE_PER_GAME} how tall / how heavy questions while the bank has others`, () => {
    expect(MAX_SIZE_PER_GAME).toBe(2);
    // Half of MIXED's estimates are, so a draw that ignored them would often take three.
    for (let seed = 1; seed <= 300; seed++) {
      const drawn = drawQuestions(MIXED, [], seeded(seed));
      expect(drawn.filter(isSizeQuestion).length, `seed ${seed}`).toBeLessThanOrEqual(MAX_SIZE_PER_GAME);
    }
    // A bank of nothing else still fills a game.
    const tall = KINDS.slice(0, 5).map((kind, i) => q(`t${i}`, kind, { question: `How tall is thing ${i}?`, unit: "metres", easy: true }));
    expect(drawQuestions(tall, [], seeded(1))).toHaveLength(5);
  });
  it("fills a round the bank lacks with estimates, rather than come up short", () => {
    const noYear = MIXED.filter((x) => roundOf(x) !== "year");
    for (let seed = 1; seed <= 50; seed++) {
      const drawn = drawQuestions(noYear, [], seeded(seed));
      expect([count(drawn, "estimate"), count(drawn, "percent"), count(drawn, "year")]).toEqual([4, 1, 0]);
    }
    expect(rounds(drawQuestions(BANK, [], seeded(1)))).toEqual(["estimate", "estimate", "estimate", "estimate", "estimate"]);
    // A bank with only percent and year questions besides one estimate: five all the same.
    const few = [q("a", "body", { easy: true }), pct("p1", "food"), pct("p2", "space"), yr("y1", "sports"), yr("y2", "culture")];
    expect(drawQuestions(few, [], seeded(2)).map((d) => d.id).sort()).toEqual(["a", "p1", "p2", "y1", "y2"]);
  });
  it("holds back the last games' percent and year questions while the bank has others, and brings back the oldest", () => {
    const rand = seeded(11);
    let recent: string[][] = [];
    for (let game = 0; game < 6; game++) {
      const ids = drawQuestions(MIXED, recent, rand).map((d) => d.id);
      expect(ids.filter((id) => recent.flat().includes(id))).toEqual([]);
      recent = [ids, ...recent].slice(0, 3);
    }
    // One percent in the bank, played last game: it comes back rather than leave the round out.
    const one = [...MIXED.filter((x) => roundOf(x) !== "percent"), pct("only", "food")];
    expect(drawQuestions(one, [["only"]], seeded(4)).map((d) => d.id)).toContain("only");
  });
});

describe("a game", () => {
  const bank = BANK;
  it("goes question, reveal, next, and ends on the results", () => {
    let g = newGame(bank.slice(0, 5).map((x) => x.id));
    expect(phaseOf(g)).toBe("question");
    g = lockIn(g, 200);
    expect(phaseOf(g)).toBe("reveal");
    // A second lock-in on a revealed question does nothing.
    expect(lockIn(g, 5)).toBe(g);
    g = nextQuestion(g);
    expect(phaseOf(g)).toBe("question");
    // Next does nothing before a guess.
    expect(nextQuestion(g)).toBe(g);
    for (const guess of [100, 400, 1e9, 98]) g = nextQuestion(lockIn(g, guess));
    expect(phaseOf(g)).toBe("results");
    const scored = scoreGame(g, bank);
    expect(scored.map((s) => s.points)).toEqual([51, 100, 42, 0, 98]);
    expect(totalOf(scored)).toBe(291);
    expect(scored.map((s) => s.band)).toEqual(["near", "dead-on", "near", "lost", "dead-on"]);
  });
  it("shares the total and five plain characters, no emoji", () => {
    let g = newGame(bank.slice(0, 5).map((x) => x.id));
    for (const guess of [200, 100, 400, 1e9, 130]) g = nextQuestion(lockIn(g, guess));
    const text = shareText(scoreGame(g, bank));
    // Squares in the results' colours, as a list's share has them (the review, Nov 9).
    expect(text).toBe(`Fathom 272/${MAX_TOTAL}\n🟪 🟨 🟪 ⬛ 🟦`);
    // Out of beta (Nov 9): the name alone, and the link to the game on a line of its own.
    expect(shareText(scoreGame(g, bank), "https://toptentacle.io/#fathom")).toBe(`Fathom 272/${MAX_TOTAL}\n🟪 🟨 🟪 ⬛ 🟦\nhttps://toptentacle.io/#fathom`);
    expect(text).not.toMatch(/beta/i);
  });
  // Nov 5 review: lost at sea shared as "□", which reads as a question not played. Every band has its own mark, and
  // none of them is an empty box.
  it("marks every band apart, and lost at sea as played", () => {
    const chars = Object.values(BAND_CHARS);
    expect(new Set(chars).size).toBe(chars.length);
    expect(chars.join("")).not.toMatch(/[□▢▫◻ ]/);
  });
});

describe("the save", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("lives under its own key and round-trips", () => {
    const store = memory();
    const save = startGame({ recent: [] }, BANK, seeded(1));
    saveFathom(save, store);
    expect([...store.m.keys()]).toEqual([FATHOM_KEY]);
    expect(loadFathom(store)).toEqual(save);
    expect(save.recent).toEqual([save.game!.ids]);
  });
  it("keeps the last three games and survives junk", () => {
    let save = { recent: [] as string[][] };
    for (let i = 0; i < 5; i++) save = startGame(save, BANK, seeded(i + 1));
    expect(save.recent).toHaveLength(3);
    const store = memory();
    store.setItem(FATHOM_KEY, "{not json");
    expect(loadFathom(store)).toEqual({ recent: [] });
    store.setItem(FATHOM_KEY, JSON.stringify({ recent: "x", game: { ids: [1] } }));
    expect(loadFathom(store)).toEqual({ recent: [] });
    expect(loadFathom(undefined)).toEqual({ recent: [] });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadFathom(throwing)).toEqual({ recent: [] });
    expect(() => saveFathom(save, throwing)).not.toThrow();
  });
  // A guess of 0% is a fair guess at a share: a save holding one picks up as it was.
  it("keeps a guess of zero (a percent) in the save", () => {
    const store = memory();
    const save = { recent: [["p", "a"]], game: { ids: ["p", "a"], guesses: [0], at: 0 } };
    saveFathom(save, store);
    expect(loadFathom(store)).toEqual(save);
    store.setItem(FATHOM_KEY, JSON.stringify({ ...save, game: { ...save.game, guesses: [-1] } }));
    expect(loadFathom(store).game).toBeUndefined();
  });
  it("resumes an unfinished game whose questions are all still in the bank", () => {
    const save = startGame({ recent: [] }, BANK, seeded(2));
    expect(resumable(save, BANK)).toEqual(save.game);
    const half = { ...save, game: lockIn(save.game!, 50) };
    expect(resumable(half, BANK)).toEqual(half.game);
    // A question gone from the bank (the real file replaced the old one): start over.
    expect(resumable(save, BANK.filter((x) => x.id !== save.game!.ids[3]))).toBeUndefined();
  });
  // Nov 5 review: a reload on the results started a new game and lost the score. A finished game reopens on its
  // results; only NEW QUESTIONS draws again.
  it("reopens a finished game on its results", () => {
    const save = startGame({ recent: [] }, BANK, seeded(2));
    let done = save.game!;
    for (let i = 0; i < 5; i++) done = nextQuestion(lockIn(done, 10));
    expect(phaseOf(done)).toBe("results");
    expect(resumable({ ...save, game: done }, BANK)).toEqual(done);
    // Not one whose questions have gone from the bank.
    expect(resumable({ ...save, game: done }, BANK.filter((x) => x.id !== done.ids[0]))).toBeUndefined();
  });
});

/* ---------- The name-it round ---------- */

// The owner: "Name a country that has 6 land borders", "Name a human organ that weighs about 1 kg" ... "brain didn't
// even register". A fair answer must always register; one locked answer per round. The lists here are a subset of the
// real ones, in the data agent's format (e2e/fixtures/fathom/lists, the browser suite's too).
const FIXTURES = join(import.meta.dirname, "..", "..", "e2e", "fixtures", "fathom");
const fixtureList = (id: string): NameList => readList(JSON.parse(readFileSync(join(FIXTURES, "lists", `${id}.json`), "utf8")))!;
const POPULATION = fixtureList("countries-population");
const AREA = fixtureList("countries-area");
const BORDERS = fixtureList("land-borders");
const CITIES = fixtureList("cities-population");
const LISTS = new Map([POPULATION, AREA, BORDERS, CITIES].map((l) => [l.id, l]));
const NAME_BANK = JSON.parse(readFileSync(join(FIXTURES, "name-questions.json"), "utf8"));
const named = readFullBank(NAME_BANK, LISTS)!;
const nameQ = (id: string) => named.find((x) => x.id === id)!;

describe("name-it: the lists", () => {
  it("reads a list in the data agent's format", () => {
    expect(POPULATION).toMatchObject({ id: "countries-population", noun: "country", nounPlural: "countries", measure: "people", scoring: "ratio" });
    expect(BORDERS.scoring).toBe("steps");
    expect(POPULATION.entries.find((e) => e.name === "United Kingdom")).toEqual({ name: "United Kingdom", aliases: ["UK", "U.K.", "Britain", "Great Britain"], value: 68350000 });
  });
  it("leaves out malformed entries, and isn't a list without a shape or an entry", () => {
    const base = { id: "x", noun: "country", nounPlural: "countries", measure: "people", scoring: "ratio", source: { title: "t", url: "https://e.org" } };
    const list = readList({ ...base, entries: [{ name: "A", value: 3 }, { name: "", value: 3 }, { name: "B", value: -1 }, { name: "C", value: "3" }, { name: "D", aliases: ["d", 4], value: 0 }] });
    expect(list?.entries).toEqual([
      { name: "A", aliases: [], value: 3 },
      { name: "D", aliases: ["d"], value: 0 },
    ]);
    expect(readList({ ...base, entries: [] })).toBeNull();
    expect(readList({ ...base, scoring: "log", entries: [{ name: "A", value: 1 }] })).toBeNull();
    expect(readList({ ...base, id: "../x", entries: [{ name: "A", value: 1 }] })).toBeNull();
    expect(readList("<!doctype html>")).toBeNull();
    expect(readList(null)).toBeNull();
  });
});

describe("name-it: reading the name", () => {
  const read = (text: string, list = POPULATION, extra: Parameters<typeof readName>[3] = {}) => readName(text, list, [...LISTS.values()], extra);
  const said = (r: NameRead) => (r.kind === "answer" || r.kind === "confirm" ? `${r.kind} ${r.entry.name}` : r.kind === "choose" ? `choose ${r.names.join(" / ")}` : r.kind === "other" ? `other ${r.name} (${r.noun})` : r.kind === "except" || r.kind === "offList" ? `${r.kind} ${r.name}` : r.kind);

  it("takes a name or any alias, however it's spelled out", () => {
    for (const [typed, name] of [
      ["Colombia", "Colombia"],
      ["colombia", "Colombia"],
      ["  COLOMBIA ", "Colombia"],
      ["UK", "United Kingdom"],
      ["u.k.", "United Kingdom"],
      ["Britain", "United Kingdom"],
      ["USA", "United States"],
      ["US", "United States"],
      ["America", "United States"],
      ["the United States", "United States"],
      ["Türkiye", "Turkey"],
      ["Turkiye", "Turkey"],
      ["turkey", "Turkey"],
      ["Holland", "Netherlands"],
      ["the netherlands", "Netherlands"],
      ["Czechia", "Czech Republic"],
      ["Burma", "Myanmar"],
      ["Côte d'Ivoire", "Ivory Coast"],
      ["cote divoire", "Ivory Coast"],
      ["DRC", "Democratic Republic of the Congo"],
      ["Guinea", "Guinea"],
      ["Niger", "Niger"],
      ["Sudan", "Sudan"],
    ])
      expect(said(read(typed)), typed).toBe(`answer ${name}`);
    expect(said(read("NYC", CITIES))).toBe("answer New York City");
    expect(said(read("Bombay", CITIES))).toBe("answer Mumbai");
    expect(said(read("Sao Paulo", CITIES))).toBe("answer São Paulo");
    expect(said(read("St Petersburg", CITIES))).toBe("answer Saint Petersburg");
  });

  it("puts a misspelling in the box to confirm, and offers the choices when it could be more than one", () => {
    expect(said(read("Frnace"))).toBe("confirm France");
    expect(said(read("Colmbia"))).toBe("confirm Colombia");
    expect(said(read("Phillipines"))).toBe("confirm Philippines");
    expect(said(read("Irak"))).toBe("choose Iran / Iraq");
    expect(said(read("Congo"))).toBe("choose Democratic Republic of the Congo / Republic of the Congo");
    expect(said(read("Korea"))).toBe("choose North Korea / South Korea");
    // A choice the game offered, typed or tapped, is that one.
    expect(said(read("Iraq", POPULATION, { offered: ["Iran", "Iraq"] }))).toBe("answer Iraq");
    expect(said(read("Republic of the Congo"))).toBe("answer Republic of the Congo");
  });

  it("knows a thing of another kind, and says so instead of reading it as something on the list", () => {
    expect(said(read("Paris"))).toBe("other Paris (city)");
    expect(said(read("tokyo"))).toBe("other Tokyo (city)");
    // A city named exactly is that city, not a misspelling of a country or the start of one's name.
    expect(said(read("Lagos"))).toBe("other Lagos (city)");
    expect(said(read("Mexico City"))).toBe("other Mexico City (city)");
    expect(said(read("Hong Kong"))).toBe("other Hong Kong (city)");
    expect(said(read("Washington"))).toBe("other Washington, D.C. (city)");
    // And a country on a city question.
    expect(said(read("France", CITIES))).toBe("other France (country)");
    expect(said(read("Japan", CITIES))).toBe("other Japan (country)");
    // A name that is both stays what the question asks for.
    expect(said(read("Singapore"))).toBe("answer Singapore");
    expect(said(read("Singapore", CITIES))).toBe("answer Singapore");
    expect(said(read("Hong Kong", CITIES))).toBe("answer Hong Kong");
    expect(said(read("Mexico"))).toBe("answer Mexico");
  });

  // The coordinator: no dependencies on the lists (Greenland, Puerto Rico are not countries). A place no list has is
  // still named for what it is, and never becomes an answer.
  it("names the places no list has for what they are: territories, US states, continents, the UK's nations", () => {
    expect(said(read("Greenland"))).toBe("other Greenland (territory)");
    expect(said(read("puerto rico"))).toBe("other Puerto Rico (territory)");
    expect(said(read("Texas"))).toBe("other Texas (US state)");
    expect(said(read("Africa"))).toBe("other Africa (continent)");
    expect(said(read("Greenland", CITIES))).toBe("other Greenland (territory)");
    // A name the list has is that: Georgia the country (once it's on the list; these fixtures leave it out), not the US
    // state.
    expect(said(read("Georgia", BORDERS))).toBe("other Georgia (US state)");
    expect(said(readName("Georgia", { ...POPULATION, entries: [...POPULATION.entries, { name: "Georgia", aliases: [], value: 3.7e6 }] }, []))).toBe("answer Georgia");
    // And a misspelling of a country is no reason to miss one: "Hawaii" is a US state, not Haiti.
    const withHaiti = { ...POPULATION, entries: [...POPULATION.entries, { name: "Haiti", aliases: [], value: 11.7e6 }] };
    expect(said(readName("Hawaii", withHaiti, []))).toBe("other Hawaii (US state)");
    expect(said(readName("Haitii", withHaiti, []))).toBe("confirm Haiti");
    // The UK's nations are countries within it (Nov 8: "England" locked the whole UK on the real lists).
    const ni = read("Northern Ireland");
    expect(ni).toEqual({ kind: "other", name: "Northern Ireland", noun: "country", partOf: "the UK" });
    expect(said(read("Scotland"))).toBe("other Scotland (country)");
    // Islands and regions are part of their country, and never a misspelling of another (Tasmania is not Tanzania).
    expect(read("Tasmania")).toEqual({ kind: "other", name: "Tasmania", noun: "island", partOf: "Australia" });
    expect(said(read("Bali", BORDERS))).toBe("other Bali (island)");
    expect(read("Canary Islands")).toEqual({ kind: "other", name: "The Canary Islands", noun: "islands", partOf: "Spain", plural: true });
    expect(said(read("Yugoslavia"))).toBe("other Yugoslavia (former country)");
    // An exact place before a near name of another kind: "Africa" on a city question is a continent, not South Africa.
    expect(said(read("Africa", CITIES))).toBe("other Africa (continent)");
    expect(said(read("South America", CITIES))).toBe("other South America (continent)");
  });

  it("says when it doesn't know it, and never turns it into an answer", () => {
    for (const typed of ["asdf", "brain", "Atlantis", "pope", "islands", "123"]) expect(said(read(typed)), typed).toBe("unknown");
    expect(said(read(""))).toBe("empty");
    expect(said(read("  "))).toBe("empty");
    // A country another list of countries has and this one doesn't.
    expect(said(read("Serbia", POPULATION))).toBe("offList Serbia");
  });

  // With the game's lexicon: a real name the list doesn't have says so, and a misspelling the lexicon happens to know as
  // a name elsewhere ("Irak") is still offered: it needs a tap either way.
  // Nov 8: the lexicon's real names were still offered as misspellings once it held them back ("Abkhazia" as
  // Afghanistan, "Tasmania" as Tanzania). Only a misspelling the game stores as one (Lexicon.slips: "Irak" of Iraq) is.
  it("with the game's lexicon, says a real name isn't on the list, and still offers what a stored misspelling means", () => {
    const lex = { ...trainLexicon(["water"], ["Berlin", "Irak", "Lagos", "Kyiv", "Irun", "Afganstan"]), slips: fnv("irak>iraq").toString(36) };
    const withLex = (text: string, l = POPULATION) => said(readName(text, l, [...LISTS.values()], { lex }));
    // A real name one slip from a country (a town in Spain) is still offered as that country, to confirm; one further
    // off (as "Abkhazia" is from Afghanistan's forms) is itself, offered only without the lexicon.
    expect(said(readName("Irun", BORDERS, [...LISTS.values()]))).toBe("confirm Iran");
    expect(withLex("Irun", BORDERS)).toBe("confirm Iran");
    expect(said(readName("Afganstan", BORDERS, [...LISTS.values()]))).toBe("confirm Afghanistan");
    expect(withLex("Afganstan", BORDERS)).toBe("offList Afganstan");
    // An ordinary word the lexicon knows is no name at all.
    expect(withLex("water")).toBe("unknown");
    expect(withLex("Berlin", CITIES)).toBe("offList Berlin");
    expect(withLex("kyiv", CITIES)).toBe("offList Kyiv");
    expect(nameLine(readName("berlin", CITIES, [], { lex }), CITIES)).toBe(`Berlin isn't one of our ${CITIES.entries.length} cities. Try again.`);
    expect(withLex("Irak")).toBe("choose Iran / Iraq");
    expect(withLex("Lagos")).toBe("other Lagos (city)");
    expect(withLex("Frnace")).toBe("confirm France");
    expect(withLex("asdf")).toBe("unknown");
  });

  // Nov 8: "Korea, North" was put in the box as South Korea, "Dominican Rep" was not one we know.
  it("reads a list's inverted form and the short forms of Republic and Democratic, exactly", () => {
    expect(rewrites("Korea, North")).toEqual(["North Korea"]);
    expect(rewrites("Gambia, The")).toEqual(["The Gambia"]);
    expect(rewrites("Dominican Rep.")).toEqual(["Dominican Republic"]);
    expect(rewrites("Congo, Dem. Rep.")).toEqual(["Dem. Rep. Congo", "Congo, Democratic Republic", "Democratic Republic Congo"]);
    expect(rewrites("France")).toEqual([]);
    expect(said(read("Korea, North"))).toBe("answer North Korea");
    expect(said(read("Korea, South"))).toBe("answer South Korea");
    expect(said(read("Congo, Republic of the"))).toBe("answer Republic of the Congo");
  });

  it("leaves out the question's own yardstick", () => {
    const except = ["United Kingdom"];
    expect(said(read("UK", AREA, { except }))).toBe("except United Kingdom");
    expect(said(read("United Kingdom", AREA, { except }))).toBe("except United Kingdom");
    expect(said(read("Ghana", AREA, { except }))).toBe("answer Ghana");
  });

  it("says each in a plain line, two lines at most at 320px", () => {
    const line = (r: NameRead, list = POPULATION) => nameLine(r, list);
    expect(line(read("Paris"))).toBe("Paris is a city, not a country. Try again.");
    expect(line(read("France", CITIES), CITIES)).toBe("France is a country, not a city. Try again.");
    expect(line(read("asdf"))).toBe("Not one we know. Try again.");
    expect(line(read("Frnace"))).toBe("France? Lock in to confirm.");
    expect(line(read("Irak"))).toBe("Did you mean");
    expect(line(read("Serbia"))).toBe(`Serbia isn't one of our ${POPULATION.entries.length} countries. Try again.`);
    expect(line(read("Greenland"))).toBe("Greenland is a territory, not a country. Try again.");
    expect(line(read("Northern Ireland"))).toBe("Northern Ireland is part of the UK. Try again.");
    // Every one ends "Try again." (the review, Nov 9: Tasmania's line didn't).
    expect(line(read("Wales", CITIES), CITIES)).toBe("Wales is part of the UK, not a city. Try again.");
    expect(line(read("Tasmania"))).toBe("Tasmania is part of Australia, not a country. Try again.");
    expect(line(read("Canary Islands"))).toBe("The Canary Islands are part of Spain. Try again.");
    expect(line(read("Brooklyn", CITIES), CITIES)).toBe("Brooklyn is part of New York City, not a city. Try again.");
    expect(line(read("Borneo"))).toBe("Borneo is an island, not a country. Try again.");
    expect(line(read("USSR"))).toBe("USSR is no longer a country. Try again.");
    expect(line(read("Yugoslavia", CITIES), CITIES)).toBe("Yugoslavia was a country, not a city. Try again.");
    expect(line({ kind: "other", name: "The Galápagos Islands Archipelago", noun: "islands", partOf: "Ecuador", plural: true })).toBe(
      "They are part of Ecuador, not a country. Try again.",
    );
    // A line too long for two lines at 320px leaves the name out, never its ending.
    expect(line(read("US Virgin Islands"))).toBe("They are a territory, not a country. Try again.");
    // Every place's line, on a country question and a city one, keeps to the longest a line gets: LINE_MAX (58), two lines at 320px
    // (fathom-name.e2e.cjs measures the longest; "US Virgin Islands are a territory, not a country. Try again." took three).
    for (const p of PLACES)
      for (const name of p.names)
        for (const l of [POPULATION, CITIES]) {
          const r = readName(name, { ...l, entries: [{ name: "Nowhere", aliases: [], value: 1 }] }, []);
          expect(r.kind, name).toBe("other");
          expect(nameLine(r, l).length, nameLine(r, l)).toBeLessThanOrEqual(LINE_MAX);
        }
    expect(line({ kind: "offList", name: "Bosnia Herzegovina" })).toBe(`That isn't one of our ${POPULATION.entries.length} countries. Try again.`);
    expect(line(read("UK", AREA, { except: ["United Kingdom"] }), AREA)).toBe("Any country but United Kingdom. Try again.");
    expect(line({ kind: "empty" })).toBe("Type a country first.");
    expect(line({ kind: "vague" })).toBe("More than one fits. Be more specific.");
    // A long name is left out of the line rather than run it to three.
    expect(line({ kind: "other", name: "Saint Vincent and the Grenadines", noun: "island" })).toBe("That is an island, not a country. Try again.");
    // The longest a line gets: an 18-letter name of another kind (fathom-name.e2e.cjs: two lines at 320px).
    for (const r of [read("Paris"), read("asdf"), read("Frnace"), { kind: "other", name: "Ho Chi Minh City", noun: "city" } as NameRead])
      expect(line(r).length, line(r)).toBeLessThanOrEqual(56);
    for (const l of [line(read("Paris")), line(read("asdf"))]) expect(l).not.toMatch(/—|\p{Extended_Pictographic}/u);
    expect(withArticle("organ")).toBe("an organ");
    expect(withArticle("US state")).toBe("a US state");
    expect(withArticle("university")).toBe("a university");
  });
});

describe("name-it: scoring", () => {
  it("steps: exactly right 100, one off 70, two off 40, three off 10, then 0", () => {
    expect(PER_STEP).toBe(30);
    expect([6, 7, 5, 8, 4, 9, 3, 10, 0, 14].map((n) => stepsScore(n, 6))).toEqual([100, 70, 70, 40, 40, 10, 10, 0, 0, 0]);
  });
  it("a ratio list scores the thing's figure against the target by the estimate's rule", () => {
    const q = nameQ("name-country-50m-people");
    expect(scoreFor(q, 50e6)).toBe(100);
    expect(scoreFor(q, 52886363)).toBe(fathomScore(52886363, 50e6));
    expect(scoreFor(q, 100e6)).toBe(51);
    expect(scoreFor(q, 25e6)).toBe(51);
    expect(scoreFor(q, 500e6)).toBe(30);
    expect(scoreFor(q, 5e9)).toBe(0);
    const steps = nameQ("name-country-6-borders");
    expect([6, 7, 9].map((n) => scoreFor(steps, n))).toEqual([100, 70, 10]);
  });
  // UX 21: closer to the target scores more, as How to play says.
  it("bears out the plain line against the target", () => {
    const pop = nameQ("name-country-50m-people");
    expect(Math.abs(scoreFor(pop, 100e6) - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(scoreFor(pop, 25e6) - 50)).toBeLessThanOrEqual(1);
    const steps = nameQ("name-country-6-borders");
    expect([6, 7, 8, 9].map((n) => scoreFor(steps, n))).toEqual([100, 70, 40, 10]);
  });
  it("says the miss plainly", () => {
    const pop = nameQ("name-country-50m-people");
    expect(nameOff(pop, 52886363)).toBe("6% more people");
    expect(nameOff(pop, 40e6)).toBe("20% fewer people");
    expect(nameOff(pop, 100e6)).toBe("2x too many people");
    expect(nameOff(pop, 15e6)).toBe("3.3x too few people");
    expect(nameOff(pop, 50.2e6)).toBe("spot on");
    // An area is a measure: as an estimate says it.
    const area = nameQ("name-country-as-big-as-uk");
    expect(nameOff(area, 238533)).toBe("2% low");
    expect(nameOff(area, 600000)).toBe("2.5x too high");
    const steps = nameQ("name-country-6-borders");
    expect(nameOff(steps, 9)).toBe("3 land borders too many");
    expect(nameOff(steps, 5)).toBe("1 land border too few");
    expect(nameOff(steps, 6)).toBe("spot on");
    expect(missText(steps, 9)).toBe("3 land borders too many");
    // Whatever reads "spot on" scores 100, and nothing else does.
    for (let f = 45e6; f <= 55e6; f += 0.1e6) expect(nameOff(pop, f) === "spot on", `${f}`).toBe(scoreFor(pop, f) === 100);
    for (let n = 0; n <= 12; n++) expect(nameOff(steps, n) === "spot on").toBe(scoreFor(steps, n) === 100);
  });
  it("shows the figures in the list's measure, one of it singular", () => {
    const pop = nameQ("name-country-50m-people");
    expect(amountText(pop, 50e6)).toBe("50 million people");
    expect(figureParts(pop, 52886363)).toEqual({ n: "52.89 million", unit: "people" });
    const steps = nameQ("name-country-6-borders");
    expect(amountText(steps, 6)).toBe("6 land borders");
    expect(amountText(steps, 1)).toBe("1 land border");
    expect(amountText(steps, 0)).toBe("0 land borders");
    expect(amountText(nameQ("name-country-as-big-as-uk"), 238533)).toBe("238,533 square kilometres");
    expect(singular("land borders")).toBe("land border");
    expect(singular("cities")).toBe("city");
    expect(unitShown(pop)).toBe("");
  });
  it("places the squid by the list's scale: powers of ten, or steps with the edge where it scores 0", () => {
    expect(offAxis("name", 100e6, 50e6, "ratio")).toBeCloseTo(Math.log10(2));
    expect(offAxis("name", 7, 6, "steps")).toBeCloseTo(0.3);
    expect(offAxis("name", 3, 6, "steps")).toBeCloseTo(-0.9);
    expect(offAxis("name", 14, 6, "steps")).toBe(1);
    expect(offAxis("name", 0, 3, "steps")).toBeCloseTo(-0.9);
    expect(stepsScore(6 + 100 / 30, 6)).toBe(0);
  });
});

describe("name-it: the questions", () => {
  it("are read with their lists: the list's measure, source and scoring, the target as the answer", () => {
    expect(nameListIds(NAME_BANK)).toEqual(["countries-population", "land-borders", "countries-area", "cities-population"]);
    expect(nameQ("name-country-50m-people")).toEqual({
      id: "name-country-50m-people",
      kind: "places",
      round: "name",
      question: "Name a country with about 50 million people",
      unit: "people",
      answer: 50e6,
      fact: "",
      source: { title: "List of countries and dependencies by population", url: "https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population" },
      nameIt: { list: "countries-population", scoring: "ratio", noun: "country", nounPlural: "countries", asOf: "2026-11-02" },
    });
    expect(nameQ("name-country-as-big-as-uk").nameIt?.except).toEqual(["United Kingdom"]);
    expect(nameQ("name-city-10m-people").definition).toBe("its whole urban area, UN figures for 2025");
    // readBank alone (no lists) leaves them out.
    expect(readBank(NAME_BANK)).toEqual([]);
  });
  it("are left out when their list isn't there, or the target leaves fewer than three good answers", () => {
    const raw = NAME_BANK.questions[0];
    expect(readNameQuestion(raw, undefined)).toBeNull();
    expect(readNameQuestion(raw, BORDERS)).toBeNull();
    expect(readFullBank(NAME_BANK, new Map())).toEqual([]);
    // 14 land borders: China and Russia, and nothing within a step.
    expect(goodAnswers(BORDERS, 14).map((e) => e.name)).toEqual(["China", "Russia"]);
    expect(MIN_GOOD).toBe(3);
    expect(readNameQuestion({ ...NAME_BANK.questions[1], target: 14 }, BORDERS)).toBeNull();
    expect(readNameQuestion({ ...NAME_BANK.questions[1], target: 6.5 }, BORDERS)).toBeNull();
    expect(readNameQuestion({ ...raw, target: 0 }, POPULATION)).toBeNull();
    expect(readNameQuestion({ ...raw, kind: "weather" }, POPULATION)).toBeNull();
    // The yardstick doesn't count toward them.
    expect(goodAnswers(AREA, 244376, ["United Kingdom"]).map((e) => e.name)).not.toContain("United Kingdom");
  });
  it("show the best answers: the closest first, the yardstick left out", () => {
    const best = (list: NameList, target: number, except?: string[]) => bestAnswers(list, target, except).map((e) => `${e.name} ${e.value}`);
    // Spain (2.8% fewer, 98) before South Korea (3.4% more, 97): by points, then how close.
    expect(best(POPULATION, 50e6)).toEqual(["Uganda 49924252", "Sudan 50448963", "Spain 48592909", "South Korea 51717590"]);
    expect(best(BORDERS, 6)).toEqual(["Italy 6", "Ethiopia 6", "Afghanistan 6", "Chad 6"]);
    // The UK's own figure on the list: Guinea (0.6% bigger) spot on, Uganda 99, then Ghana and Romania at 98, Ghana closer.
    expect(best(AREA, 244376, ["United Kingdom"])).toEqual(["Guinea 245857", "Uganda 241550", "Ghana 238533", "Romania 238397"]);
  });
  it("says when the figures are from", () => {
    expect(asOfText("2026-11-02")).toBe("November 2026");
    expect(asOfText("2024")).toBe("2024");
    expect(asOfText(undefined)).toBe("");
  });
});

describe("name-it: a game", () => {
  const NUMBERS = MIXED;
  const withNames = [...NUMBERS, ...named];
  it("plays the name-it round fifth in the shape, never first, when the bank has one", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const drawn = drawQuestions(withNames, [], seeded(seed));
      expect(drawn.map(roundOf).filter((r) => r === "name"), `seed ${seed}`).toHaveLength(1);
      expect(roundOf(drawn[0]), `seed ${seed}`).not.toBe("name");
      expect(drawn.map(roundOf).sort()).toEqual(["estimate", "estimate", "name", "percent", "year"]);
    }
    // Anywhere after the first.
    const at = new Set(Array.from({ length: 200 }, (_, s) => drawQuestions(withNames, [], seeded(s + 1)).findIndex((x) => roundOf(x) === "name")));
    expect([...at].sort()).toEqual([1, 2, 3, 4]);
    // Even an easy one never opens.
    const easy = named.map((x) => ({ ...x, easy: true }));
    for (let seed = 1; seed <= 50; seed++) expect(roundOf(drawQuestions([...NUMBERS, ...easy], [], seeded(seed))[0])).not.toBe("name");
  });
  it("is an estimate when the bank has none (its lists didn't load)", () => {
    for (let seed = 1; seed <= 50; seed++) expect(drawQuestions(readFullBank({ version: 1, questions: [...NUMBERS, ...NAME_BANK.questions] }, new Map())!, [], seeded(seed)).map(roundOf).sort()).toEqual(["estimate", "estimate", "estimate", "percent", "year"]);
  });
  it("locks one answer, keeps what was named, scores its figure, and shares like any round", () => {
    const bank = [q("a", "body"), nameQ("name-country-50m-people"), q("b", "food"), q("c", "space"), q("d", "sports")];
    let g = newGame(bank.map((x) => x.id));
    g = nextQuestion(lockIn(g, 100));
    g = lockIn(g, 52886363, "Colombia");
    expect(phaseOf(g)).toBe("reveal");
    expect(lockIn(g, 1, "Spain")).toBe(g);
    expect(g.picks).toEqual({ "name-country-50m-people": "Colombia" });
    g = nextQuestion(g);
    for (const guess of [100, 200, 50]) g = nextQuestion(lockIn(g, guess));
    const scored = scoreGame(g, bank);
    expect(scored[1]).toMatchObject({ pick: "Colombia", guess: 52886363, points: fathomScore(52886363, 50e6), band: "dead-on" });
    expect(scored[0].pick).toBeUndefined();
    expect(totalOf(scored)).toBe(100 + fathomScore(52886363, 50e6) + 100 + 51 + 51);
    expect(shareText(scored)).toBe(`Fathom ${totalOf(scored)}/500\n🟨 🟨 🟨 🟪 🟪`);
  });
  it("keeps what was named in the save, and drops a pick that isn't a name of this game's", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const game = { ids: ["a", "n"], guesses: [100, 6], at: 1, picks: { n: "Italy" } };
    saveFathom({ recent: [], game }, store);
    expect(loadFathom(store).game).toEqual(game);
    store.setItem(FATHOM_KEY, JSON.stringify({ recent: [], game: { ...game, picks: { n: 4, x: "Spain" } } }));
    expect(loadFathom(store).game).toEqual({ ids: ["a", "n"], guesses: [100, 6], at: 1 });
    // A land border count of 0 is a fair figure.
    store.setItem(FATHOM_KEY, JSON.stringify({ recent: [], game: { ...game, guesses: [100, 0], picks: { n: "Japan" } } }));
    expect(loadFathom(store).game?.guesses).toEqual([100, 0]);
  });
});
