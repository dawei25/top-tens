import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  askFor,
  BAND_CHARS,
  bandLabel,
  bandOf,
  drawQuestions,
  echoText,
  FATHOM_KEY,
  fathomScore,
  formatAmount,
  formatDigits,
  formatWords,
  loadFathom,
  lockIn,
  MAX_TOTAL,
  MIN_PLAYERS,
  newGame,
  nextQuestion,
  parseNumber,
  phaseOf,
  playersLine,
  readBank,
  readNumber,
  resumable,
  RULE,
  saveFathom,
  scoreGame,
  shareText,
  startGame,
  timesOff,
  totalOf,
  type FathomKind,
  type FathomQuestion,
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

describe("formatting", () => {
  it("echoes digits and words", () => {
    expect(echoText(2_500_000)).toBe("2,500,000 · 2.5 million");
    expect(echoText(3000)).toBe("3,000 · 3 thousand");
    expect(echoText(1_500_000_000)).toBe("1,500,000,000 · 1.5 billion");
    expect(echoText(330)).toBe("330");
    expect(echoText(0.1)).toBe("0.1");
    expect(echoText(1e30)).toBe("1e30");
    // From a trillion, the words alone: the digits ran the line past a 320px phone's width.
    expect(echoText(999.9e9)).toBe("999,900,000,000 · 999.9 billion");
    expect(echoText(3.04e12)).toBe("3.04 trillion");
    expect(echoText(999e12)).toBe("999 trillion");
  });
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
    const bank = BANK.slice(0, 6).map((x) => ({ ...x, easy: true }));
    const recent = [["q0", "q1", "q2"], ["q3", "q4"], ["q5"]];
    const ids = drawQuestions(bank, recent, seeded(3)).map((d) => d.id);
    // q5 (three games ago) first, then q3, q4 (two ago), then from the last game.
    expect(ids[0]).toBe("q5");
    expect(ids.slice(1, 3).sort()).toEqual(["q3", "q4"]);
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
    // The two kinds come first, before any repeat.
    expect(new Set(drawn.slice(0, 2).map((d) => d.kind)).size).toBe(2);
  });
  it("is random", () => {
    const firsts = new Set(Array.from({ length: 60 }, (_, s) => drawQuestions(BANK, [], seeded(s + 1)).map((d) => d.id).join()));
    expect(firsts.size).toBeGreaterThan(30);
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
