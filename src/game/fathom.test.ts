import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  amountText,
  askFor,
  BAND_CHARS,
  bandLabel,
  bandOf,
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
  RULE,
  RULES,
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
  type FathomKind,
  type FathomQuestion,
  type Round,
} from "./fathom";

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
  it("is round(100 x (1 - d)^2), d the distance in powers of ten, either way", () => {
    for (const r of [1.02, 1.1, 1.3, 1.7, 2, 3, 5, 9.9]) {
      const want = Math.round(100 * (1 - Math.log10(r)) ** 2);
      expect(fathomScore(100 * r, 100), `${r}x too high`).toBe(want);
      expect(fathomScore(100 / r, 100), `${r}x too low`).toBe(want);
    }
  });
  it("scores the rule's landmarks: 10% off 92, 25% off 82, half or double 49, 3x 27, 10x and beyond 0", () => {
    expect(fathomScore(110, 100)).toBe(92);
    expect(fathomScore(125, 100)).toBe(82);
    expect(fathomScore(200, 100)).toBe(49);
    expect(fathomScore(50, 100)).toBe(49);
    expect(fathomScore(300, 100)).toBe(27);
    expect(fathomScore(1000, 100)).toBe(0);
    expect(fathomScore(10, 100)).toBe(0);
    expect(fathomScore(1e30, 1)).toBe(0);
  });
  it("never goes up as the guess gets further off", () => {
    let last = 101;
    for (let r = 1; r <= 12; r *= 1.01) {
      const p = fathomScore(100 * r, 100);
      expect(p).toBeLessThanOrEqual(last);
      last = p;
    }
  });
  // The judge's estimate stays in the file, but it no longer moves a score: the same miss scores the same everywhere.
  it("ignores the question's typical miss", () => {
    const bank = [q("a", "body", { typical: 1.3 }), q("b", "food", { typical: 30 })];
    const g = nextQuestion(lockIn(nextQuestion(lockIn(newGame(["a", "b"]), 200)), 200));
    expect(scoreGame(g, bank).map((s) => s.points)).toEqual([49, 49]);
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

describe("the rule on screen", () => {
  // Stated where the player looks before the first answer, and on the results, in words that agree with the numbers.
  it("says what a miss scores, and the numbers agree", () => {
    expect(RULE).toBe("Half or double the answer scores about 50. Ten times off scores 0.");
    for (const guess of [50, 200]) expect(Math.abs(fathomScore(guess, 100) - 50)).toBeLessThanOrEqual(1);
    for (const guess of [10, 1000]) expect(fathomScore(guess, 100)).toBe(0);
  });
});

/** A percent question and a year question, as the bank holds them. */
const pct = (id: string, kind: FathomKind, extra: Partial<FathomQuestion> = {}) => q(id, kind, { round: "percent", unit: "percent", answer: 71, ...extra });
const yr = (id: string, kind: FathomKind, extra: Partial<FathomQuestion> = {}) => q(id, kind, { round: "year", unit: "year", answer: 2007, ...extra });

// The owner's revamp: two new rounds beside the estimate. A percent is scored by points off, a year by years off: a
// ratio means nothing there (65% for 71% is 9% off but 6 points; 2004 for 2007 is 0.06% off).
describe("rounds", () => {
  it("a question without a round is an estimate", () => {
    expect(roundOf(q("a", "body"))).toBe("estimate");
    expect(roundOf(pct("p", "body"))).toBe("percent");
    expect(roundOf(yr("y", "body"))).toBe("year");
  });

  it("percent: each point off costs 3, spot on (within half a point) 100", () => {
    expect(percentScore(71, 71)).toBe(100);
    expect(percentScore(71.4, 71)).toBe(100);
    expect(percentScore(70.6, 71)).toBe(100);
    expect(percentScore(70, 71)).toBe(97);
    expect(percentScore(65, 71)).toBe(82);
    expect(percentScore(77, 71)).toBe(82);
    expect(percentScore(61, 71)).toBe(70);
    expect(percentScore(81, 71)).toBe(70);
    expect(percentScore(38, 71)).toBe(1);
    expect(percentScore(37, 71)).toBe(0);
    expect(percentScore(0, 71)).toBe(0);
    expect(percentScore(100, 2)).toBe(0);
    // Half a point is not spot on: 98.5, and only spot on is 100.
    expect(percentScore(71.5, 71)).toBe(99);
  });

  it("year: each year off costs 5, the exact year 100", () => {
    expect(yearScore(2007, 2007)).toBe(100);
    expect(yearScore(2006, 2007)).toBe(95);
    expect(yearScore(2009, 2007)).toBe(90);
    expect(yearScore(2005, 2007)).toBe(90);
    expect(yearScore(1997, 2007)).toBe(50);
    expect(yearScore(2017, 2007)).toBe(50);
    expect(yearScore(1988, 2007)).toBe(5);
    expect(yearScore(1987, 2007)).toBe(0);
    expect(yearScore(1066, 2007)).toBe(0);
  });

  it("scores each question by its round's rule", () => {
    expect(scoreFor(q("a", "body"), 200)).toBe(fathomScore(200, 100));
    expect(scoreFor(pct("p", "body"), 65)).toBe(82);
    expect(scoreFor(yr("y", "body"), 2004)).toBe(85);
    const bank = [q("a", "body"), pct("p", "food"), yr("y", "space")];
    const g = [200, 65, 2004].reduce((game, guess) => nextQuestion(lockIn(game, guess)), newGame(["a", "p", "y"]));
    expect(scoreGame(g, bank).map((s) => s.points)).toEqual([49, 82, 85]);
  });

  it("never goes up as a guess gets further off, either way", () => {
    for (const [score, answer, step] of [
      [percentScore, 50, 0.25],
      [yearScore, 1900, 1],
    ] as const) {
      let up = 101;
      let down = 101;
      for (let off = 0; off <= 40; off += step) {
        expect(score(answer + off, answer)).toBeLessThanOrEqual(up);
        expect(score(answer - off, answer)).toBeLessThanOrEqual(down);
        expect(score(answer + off, answer)).toBe(score(answer - off, answer));
        up = score(answer + off, answer);
        down = score(answer - off, answer);
      }
    }
  });

  // UX 21: each round says its rule in one plain line before the answer, and the rule agrees with the numbers.
  it("each round's rule is one plain line that agrees with the numbers", () => {
    expect(RULES.estimate).toBe(RULE);
    expect(RULES.percent).toBe("Each point off costs 3, so 10 off scores 70.");
    expect(RULES.year).toBe("Each year off costs 5, so 10 years off scores 50.");
    expect(percentScore(60, 50)).toBe(70);
    expect(percentScore(40, 50)).toBe(70);
    expect(percentScore(51, 50)).toBe(97);
    expect(yearScore(1910, 1900)).toBe(50);
    expect(yearScore(1890, 1900)).toBe(50);
    expect(yearScore(1901, 1900)).toBe(95);
    for (const rule of Object.values(RULES)) {
      expect(rule).not.toMatch(/—|\p{Extended_Pictographic}/u);
      expect(rule.length).toBeLessThanOrEqual(70);
    }
  });

  it("says a percent's miss in points, a year's in years early or late", () => {
    expect(pointsOff(65, 71)).toBe("6 points low");
    expect(pointsOff(72, 71)).toBe("1 point high");
    expect(pointsOff(73.5, 71)).toBe("2.5 points high");
    expect(pointsOff(71.96, 71)).toBe("1 point high");
    expect(pointsOff(71.3, 71)).toBe("spot on");
    expect(pointsOff(0, 71)).toBe("71 points low");
    expect(yearsOff(2004, 2007)).toBe("3 years early");
    expect(yearsOff(2008, 2007)).toBe("1 year late");
    expect(yearsOff(1066, 2007)).toBe("941 years early");
    expect(yearsOff(2007, 2007)).toBe("spot on");
    expect(missText(q("a", "body"), 300)).toBe("3x too high");
    expect(missText(pct("p", "body"), 65)).toBe("6 points low");
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

  it("places the squid by the round's own scale, at the edge where the score reaches 0", () => {
    expect(offAxis("estimate", 200, 100)).toBeCloseTo(Math.log10(2));
    expect(offAxis("estimate", 1, 100)).toBe(-1);
    expect(offAxis("estimate", 1e9, 100)).toBe(1);
    expect(offAxis("percent", 81, 71)).toBeCloseTo(0.3);
    expect(offAxis("percent", 61, 71)).toBeCloseTo(-0.3);
    expect(offAxis("percent", 0, 71)).toBe(-1);
    expect(offAxis("year", 2017, 2007)).toBeCloseTo(0.5);
    expect(offAxis("year", 1950, 2007)).toBe(-1);
    // The edge is where the round scores 0.
    expect(percentScore(71 + 100 / 3, 71)).toBe(0);
    expect(yearScore(2027, 2007)).toBe(0);
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
    }
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

// The owner's revamp plan: five rounds a game, two estimates, a percent, a year, and a fifth that will be a name-it
// round (another estimate until then); a mixed order with an easy one first; at most two how tall / how heavy.
describe("the game's shape", () => {
  const rounds = (drawn: FathomQuestion[]) => drawn.map(roundOf);
  const count = (drawn: FathomQuestion[], round: Round) => rounds(drawn).filter((r) => r === round).length;

  it("is two estimates, a percent, a year, and a fifth that is an estimate for now", () => {
    expect(GAME_ROUNDS).toEqual(["estimate", "estimate", "percent", "year", "estimate"]);
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
    expect(scored.map((s) => s.points)).toEqual([49, 100, 16, 0, 98]);
    expect(totalOf(scored)).toBe(263);
    expect(scored.map((s) => s.band)).toEqual(["near", "dead-on", "far", "lost", "dead-on"]);
  });
  it("shares the total and five plain characters, no emoji", () => {
    let g = newGame(bank.slice(0, 5).map((x) => x.id));
    for (const guess of [200, 100, 400, 1e9, 130]) g = nextQuestion(lockIn(g, guess));
    const text = shareText(scoreGame(g, bank));
    expect(text).toBe(`Fathom beta 244/${MAX_TOTAL}\n▒ █ ░ × ▓`);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
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
