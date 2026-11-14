/**
 * Fathom (#fathom): five questions, about two minutes, no timer, no lives. Four ask for a number and one asks the
 * player to name a thing whose figure is close to a target (the name-it round, src/game/fathom-name.ts reads the name).
 * Each scores by how close it is, on one curve (`curve`) with a distance for each round: an estimate by how many times
 * off, a percent by points off and how many times off on the answer's side of 50 (the average), a year by how many
 * times off how long ago it was, a name-it round by its list's figure against the target (a ratio, or steps off). The
 * game says no scoring line (the owner, Nov 14: "self intuitive already enough"); How to play explains it in one.
 *
 * Pure functions only: reading numbers, scoring, the draw, the share text, and the game on screen (its own localStorage
 * key). Finished games, their totals and the last draws are kept in the player's save, which syncs with an account
 * (src/game/fathom-history.ts); Fathom touches no list record, stat or streak. With a backend, each guess is also sent
 * (src/net/fathom.ts).
 */
import { BANDS, bandLabel, bandOf, FATHOM_KEY, HOLD_GAMES, type Band } from "./fathom-history";

export { HOLD_GAMES };

export const FATHOM_KINDS = [
  "body",
  "animals",
  "landmarks",
  "places",
  "space",
  "food",
  "everyday",
  "nature",
  "science",
  "sports",
  "culture",
  "lists",
] as const;
export type FathomKind = (typeof FATHOM_KINDS)[number];

/** The typical miss on a question, as a ratio (2: people are usually about 2x off): the writers' estimate. */
export const TYPICALS = [1.3, 1.5, 2, 3, 5, 10, 30] as const;

/**
 * How a question is asked and scored. An estimate (the default) is a number in a unit, scored by how many times off;
 * a percent is 0 to 100 (unit "percent"), scored by points off and how many times off its share (or, past 50, its
 * complement) is; a year is an AD year (unit "year"), scored by how many times off how long ago it was; a name-it
 * round asks for a thing from a list ("Name a country with about 50 million people"), scored by that thing's figure
 * against the target. `kind` is the topic, apart from this.
 */
export const ROUNDS = ["estimate", "percent", "year", "name"] as const;
export type Round = (typeof ROUNDS)[number];

/** The unit a percent or a year question is in (scripts/fathom/check.ts holds the bank to it). */
export const ROUND_UNITS: Partial<Record<Round, string>> = { percent: "percent", year: "year" };

export const roundOf = (q: Pick<FathomQuestion, "round">): Round => q.round ?? "estimate";

/**
 * How a name-it round scores the figure of the thing named against the target: `ratio` by the estimate's rule (how
 * many times off: a population, an area), `steps` by whole steps off (a count of land borders).
 */
export type NameScoring = "ratio" | "steps";

/** What a name-it question takes from its list (src/game/fathom-name.ts fills it in when the bank is read). */
export interface NameIt {
  /** The list's id: public/fathom/lists/<id>.json. */
  list: string;
  scoring: NameScoring;
  /** What the player names: "country", "countries". */
  noun: string;
  nounPlural: string;
  /** Names that don't count, said plainly: "France" on "Name a country about as big as France". */
  except?: string[];
  /** When the list's figures are from, as the list says it. */
  asOf?: string;
}

export interface FathomQuestion {
  id: string;
  kind: FathomKind;
  /** Absent: an estimate. */
  round?: Round;
  question: string;
  /**
   * Shown beside the input and with the answer: "metres", or with a scale word for big counts ("million people",
   * "billion trees"), so every answer has at most 6 digits before the decimal point and the player just types it. A
   * name-it round's is its list's measure ("people", "km²", "land borders").
   */
  unit: string;
  /** A name-it round's is its target. */
  answer: number;
  /** What exactly is measured: "to the tip of its antenna". */
  definition?: string;
  /** Empty on a name-it round without one (its best answers are the reveal). */
  fact: string;
  /** A name-it round's is its list's. */
  source: { title: string; url: string };
  /**
   * The writers' estimate of the typical miss (docs/FATHOM.md). In the file, checked by scripts/fathom/check.ts, but
   * the game doesn't read it: it no longer moves a score (one rule for every question).
   */
  typical?: number;
  /** The first question of a game is always an easy one. */
  easy?: boolean;
  /** A name-it round's list and its scoring. */
  nameIt?: NameIt;
}

export interface FathomBank {
  version: 1;
  questions: FathomQuestion[];
}

export const QUESTIONS_PER_GAME = 5;
export const POINTS_PER_QUESTION = 100;
export const MAX_TOTAL = QUESTIONS_PER_GAME * POINTS_PER_QUESTION;

/* ---------- Scoring ---------- */

/** Within 1% of the answer: the reveal says "spot on", and it scores full marks. */
export const spotOn = (guess: number, answer: number): boolean => Math.abs(guess - answer) <= Math.abs(answer) * 0.01;

/**
 * The one curve every round scores on: d is how far off on the round's scale (signed or not), 1 where it reaches 0.
 * 100 x max(0, 1 - |d|)^2, rounded: d 0.1 scores 81, 0.3 49, 0.5 25. A miss never scores 100 (the rounds cap it at 99:
 * only spot on is full marks).
 */
export const curve = (d: number): number => Math.round(POINTS_PER_QUESTION * Math.max(0, 1 - Math.abs(d)) ** 2);

/** The best a guess that isn't spot on can score. */
const MISS_MAX = POINTS_PER_QUESTION - 1;

/**
 * Points for a guess, 0 to 100, the same rule for every estimate (the owner: plain closeness): the curve, with d =
 * log10(guess / answer), how many powers of ten off it is. Spot on (within 1%) is 100 and only spot on is; within 10%
 * about 92, 25% off 82, half or double 49, 3x 27, and 10x off or more 0.
 */
export function fathomScore(guess: number, answer: number): number {
  if (spotOn(guess, answer)) return POINTS_PER_QUESTION;
  const d = Math.log10(guess / answer);
  if (!Number.isFinite(d)) return 0;
  return Math.min(MISS_MAX, curve(d));
}

/** A percent within half a point of the answer: spot on, full marks. */
const percentSpotOn = (guess: number, answer: number): boolean => Math.abs(guess - answer) < 0.5;

/** A share kept off 0 and 100 (0.5 to 99.5), so how many times off it is stays finite: a guess of 0 is a fair one. */
const share = (p: number): number => Math.min(99.5, Math.max(0.5, p));

/**
 * How far off a percent guess is, in powers of ten, on the answer's side of 50: up to 50 the shares themselves
 * (log10(guess / answer)), past 50 their complements, what's left (log10((100 - answer) / (100 - guess))). Positive
 * when the guess is higher. So 20 for 25 is as far off as 80 for 75, 90 for 99 as far as 10 for 1 (10x: the edge).
 */
export function percentOff(guess: number, answer: number): number {
  return answer > 50 ? Math.log10(share(100 - answer) / share(100 - guess)) : Math.log10(share(guess) / share(answer));
}

/** Points a percent's points-off half loses for each point off (so about 33 points off scores 0 there). */
export const PER_POINT = 3;

/** A percent's points-off half: 100 - 3 x points off, rounded, never under 0. */
const pointsHalf = (guess: number, answer: number): number =>
  Math.max(0, Math.round(POINTS_PER_QUESTION - PER_POINT * Math.abs(guess - answer)));

/**
 * Points for a percent guess: the average of two scores, rounded. One counts points off (100 - 3 a point, never under
 * 0); the other how many times off (the curve on percentOff), so a small share's miss counts for more than a big one's
 * of the same points. Within half a point is spot on, 100; a miss at most 99. 20 for 25 scores 84, 5 for 2.5 71, 10
 * for 2.5 47, 0.8 for 25 14, 90 for 71 36.
 */
export function percentScore(guess: number, answer: number): number {
  if (percentSpotOn(guess, answer)) return POINTS_PER_QUESTION;
  return Math.min(MISS_MAX, Math.round((pointsHalf(guess, answer) + curve(percentOff(guess, answer))) / 2));
}

/** The current calendar year: a year round measures how long ago from it. */
export const currentYear = (): number => new Date().getFullYear();

/** How many times a year's distance counts against an estimate's: 2, so the edge is about 3.2x off in time ago. */
export const YEAR_STRETCH = 2;

/** Years before `now`, at least 1 (this year and later count as last year, so the ratio stays finite). */
const ago = (year: number, now: number): number => Math.max(1, now - year);

/**
 * How far off a year guess is, by how long ago it was: 2 x log10(ago(answer) / ago(guess)), positive when the guess is
 * later. Ten years off an event 20 years ago is far; ten years off one 300 years ago is close. `now` is this year.
 */
export function yearOff(guess: number, answer: number, now: number = currentYear()): number {
  return YEAR_STRETCH * Math.log10(ago(answer, now) / ago(guess, now));
}

/** A year guess that reads as the year itself ("spot on"). */
const yearSpotOn = (guess: number, answer: number): boolean => Math.round(Math.abs(guess - answer)) === 0;

/**
 * Points for a year guess: the curve on yearOff. The exact year is 100. With now 2026: 1984 for 1967 scores 50, 1960
 * for 1967 81, 2010 for 2007 72, 2000 for 2007 53, 1850 for 1903 47.
 */
export function yearScore(guess: number, answer: number, now: number = currentYear()): number {
  if (yearSpotOn(guess, answer)) return POINTS_PER_QUESTION;
  return Math.min(MISS_MAX, curve(yearOff(guess, answer, now)));
}

/** Points a name-it round on a steps list loses for each step off (one land border off scores 70, two 40). */
export const PER_STEP = 30;

/** Points for a figure a whole number of steps from the target: 100 - 30 x steps off, never under 0. */
export function stepsScore(guess: number, answer: number): number {
  return Math.max(0, Math.round(POINTS_PER_QUESTION - PER_STEP * Math.abs(guess - answer)));
}

/** Points for a name-it round: the figure of the thing named against the target, by its list's scoring. */
export const nameScore = (scoring: NameScoring | undefined, figure: number, target: number): number =>
  scoring === "steps" ? stepsScore(figure, target) : fathomScore(figure, target);

/**
 * Points for a guess on a question, by its round's rule. A name-it round's guess is the figure of the thing named (its
 * population, its land borders), against the target. `now`, this year, is what a year round measures from.
 */
export function scoreFor(q: Pick<FathomQuestion, "round" | "answer" | "nameIt">, guess: number, now: number = currentYear()): number {
  const round = roundOf(q);
  if (round === "percent") return percentScore(guess, q.answer);
  if (round === "year") return yearScore(guess, q.answer, now);
  if (round === "name") return nameScore(q.nameIt?.scoring, guess, q.answer);
  return fathomScore(guess, q.answer);
}

/** "land borders" as one: "land border". */
export function singular(unit: string): string {
  if (/(?:ss|us|is)$/.test(unit)) return unit;
  if (/ies$/.test(unit)) return unit.replace(/ies$/, "y");
  if (/(?:ch|sh|x)es$/.test(unit)) return unit.replace(/es$/, "");
  return unit.replace(/s$/, "");
}

// The bands live with the history (Past runs shows a game's five squares without this module).
export { BANDS, bandLabel, bandOf, type Band };

/** A ratio for "Nx too high", from 2: 2, 2.4, 12, 1,500, 3 million. */
function ratioText(r: number): string {
  if (r < 9.95) return trimZeros(r.toFixed(1));
  if (r < 1e6) return Math.round(r).toLocaleString("en-US");
  return formatWords(r);
}
const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** "2.4x", "12x", "3 million times". A plain x, not the times sign: the pixel font has no "×", and a fallback glyph stood out. */
function times(r: number): string {
  const t = ratioText(r);
  return /[a-z]$/.test(t) ? `${t} times` : `${t}x`;
}

/**
 * The miss in plain words: "spot on" within 1%, a percent within 2x ("30% low", "20% high"), and times from there
 * ("3x too high", "4x too low", "3 million times too low"). A percent that would round to 100 is "2x too high".
 */
export function timesOff(guess: number, answer: number): string {
  if (spotOn(guess, answer)) return "spot on";
  const high = guess > answer;
  const ratio = high ? guess / answer : answer / guess;
  const percent = Math.round((Math.abs(guess - answer) / answer) * 100);
  if (ratio < 2 && percent < 100) return `${percent}% ${high ? "high" : "low"}`;
  return `${times(Math.max(2, ratio))} too ${high ? "high" : "low"}`;
}

/** A percent's miss, in percentage points: "6 too low", "1 too high", "2.5 too high", "spot on" within half a point. */
export function pointsOff(guess: number, answer: number): string {
  if (percentSpotOn(guess, answer)) return "spot on";
  // Not "12 points high": the reveal's points are the score (the review, Nov 9: "NEAR 68 points" beside it).
  const off = trimZeros(Math.abs(guess - answer).toFixed(1));
  return `${off} too ${guess > answer ? "high" : "low"}`;
}

/** A year's miss: "3 years early", "1 year late", "spot on" for the year itself. */
export function yearsOff(guess: number, answer: number): string {
  const off = Math.round(Math.abs(guess - answer));
  if (off === 0) return "spot on";
  return `${off} ${off === 1 ? "year" : "years"} ${guess > answer ? "late" : "early"}`;
}

/**
 * A name-it round's miss, the thing's figure against the target. Steps: "3 land borders too many", "1 land border too
 * few". A ratio on a count: "6% more people", "20% fewer people", "2x too many people", "3x too few people"; on a unit
 * of measure, as an estimate's ("6% high", "2x too high"). "spot on" where it scores 100.
 */
export function nameOff(q: Pick<FathomQuestion, "answer" | "unit" | "nameIt">, figure: number): string {
  const target = q.answer;
  if (q.nameIt?.scoring === "steps") {
    const off = Math.round(Math.abs(figure - target));
    if (off === 0) return "spot on";
    return `${off} ${off === 1 ? singular(q.unit) : q.unit} too ${figure > target ? "many" : "few"}`;
  }
  if (measureOf(q.unit) || spotOn(figure, target)) return timesOff(figure, target);
  const high = figure > target;
  const ratio = high ? figure / target : target / figure;
  const percent = Math.round((Math.abs(figure - target) / target) * 100);
  if (ratio < 2 && percent < 100) return `${percent}% ${high ? "more" : "fewer"} ${q.unit}`;
  return `${times(Math.max(2, ratio))} too ${high ? "many" : "few"} ${q.unit}`;
}

/** The miss in the round's own words: "3x too high", "6 points low", "3 years early", "3 land borders too many". */
export function missText(q: Pick<FathomQuestion, "round" | "answer" | "unit" | "nameIt">, guess: number): string {
  const round = roundOf(q);
  if (round === "percent") return pointsOff(guess, q.answer);
  if (round === "year") return yearsOff(guess, q.answer);
  if (round === "name") return nameOff(q, guess);
  return timesOff(guess, q.answer);
}

/** Steps off where a name-it round on a steps list reaches 0 (100 / 30 of them). */
const STEPS_EDGE = POINTS_PER_QUESTION / PER_STEP;

/**
 * How far off a guess is on its round's scale, from -1 (too low or early) to 1 (too high or late): the distance each
 * round scores by, 1 where its curve reaches 0. Powers of ten for an estimate (10x off) and a name-it round on a ratio
 * list; for a percent, powers of ten on the answer's side of 50 (percentOff: 10x off its share or what's left, where
 * its times-off half reaches 0); for a year, yearOff (about 3.2x off how long ago); steps for a name-it round on a
 * steps list (100 / 30). The sonar places the squid by it: further out on either side never scores more.
 */
export function offAxis(round: Round, guess: number, answer: number, scoring?: NameScoring, now: number = currentYear()): number {
  const d =
    round === "percent"
      ? percentOff(guess, answer)
      : round === "year"
        ? yearOff(guess, answer, now)
        : round === "name" && scoring === "steps"
          ? (guess - answer) / STEPS_EDGE
          : Math.log10(guess / answer);
  return Number.isNaN(d) ? 0 : Math.max(-1, Math.min(1, d));
}

/** The most "how tall / how heavy" questions in one game (the owner: too many of them). */
export const MAX_SIZE_PER_GAME = 2;

/** Asks how big or heavy a thing is: "How tall...", "How long is...", "How deep...", "...weigh?", "What weight of...". */
const ASKS_SIZE = /^how (?:tall|long|high|deep|wide|big|large|thick|heavy)\b|\bweigh(?:s|ed)?\b|\bweight\b/i;

/**
 * A "how tall / how heavy" question: an estimate whose unit is a length or a mass (any scale word in front) and that
 * asks how tall, long, high, deep, wide, big or heavy something is, or what it weighs. A distance ("How far..."), an
 * amount used ("How much tea..."), a growth or a duration isn't one, nor is a percent or a year. A game has at most
 * MAX_SIZE_PER_GAME, and the bank at most one in five (scripts/fathom/check.ts).
 */
export function isSizeQuestion(q: Pick<FathomQuestion, "question" | "unit" | "round">): boolean {
  if (roundOf(q) !== "estimate") return false;
  const kind = measureOf(splitScale(q.unit).base ?? "")?.kind;
  return (kind === "length" || kind === "mass") && ASKS_SIZE.test(q.question.trim());
}

/** Players needed on a question before its reveal says how they guessed. */
export const MIN_PLAYERS = 20;

/**
 * The reveal's line about real players (fathom_compare, through src/net): "Players' typical guess: 4 litres · you were
 * closer than 72%", from MIN_PLAYERS players on; null below that (the reveal shows nothing) or without numbers. The
 * share is rounded down, so 100% is everyone. A percent's typical guess shows to a tenth ("64.3%"), a year's whole.
 */
export function playersLine(
  crowd: { n: number; median: number | null; furtherOff: number | null } | null,
  unit: string,
  round: Round = "estimate",
): string | null {
  if (!crowd || crowd.n < MIN_PLAYERS || crowd.median === null || crowd.furtherOff === null) return null;
  const share = Math.floor(crowd.furtherOff * 100 + 1e-9);
  const median = round === "year" ? Math.round(crowd.median) : round === "percent" ? Math.round(crowd.median * 10) / 10 : crowd.median;
  return `Players' typical guess: ${amountText({ unit, round }, median)} · you were closer than ${share}%`;
}

/* ---------- Reading numbers ---------- */

/** Words and short forms that multiply the number before them. */
const SCALES: Record<string, number> = {
  hundred: 1e2,
  hundreds: 1e2,
  k: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  m: 1e6,
  mn: 1e6,
  mil: 1e6,
  million: 1e6,
  millions: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  billions: 1e9,
  t: 1e12,
  tn: 1e12,
  trillion: 1e12,
  trillions: 1e12,
};

/**
 * A unit a player may type after the number. Units of one kind convert into each other by their sizes; one without a
 * size is recognized but not converted (feet, pounds, Fahrenheit: the game is metric), so the player is asked for the
 * question's unit instead. Names are lowercase; a name may stand for units of several kinds ("m": metres, minutes,
 * months), and the question's kind decides.
 */
interface Unit {
  kind: string;
  /** In the kind's smallest unit here, so sizes are whole numbers. */
  size?: number;
  names: readonly string[];
}

const UNITS: readonly Unit[] = [
  // Length, in millimetres.
  { kind: "length", size: 1, names: ["mm", "millimetre", "millimetres", "millimeter", "millimeters"] },
  { kind: "length", size: 10, names: ["cm", "cms", "centimetre", "centimetres", "centimeter", "centimeters"] },
  { kind: "length", size: 1e3, names: ["m", "metre", "metres", "meter", "meters"] },
  { kind: "length", size: 1e6, names: ["km", "kms", "kilometre", "kilometres", "kilometer", "kilometers"] },
  { kind: "length", names: ["in", "inch", "inches", "ft", "foot", "feet", "yd", "yard", "yards", "mi", "mile", "miles"] },
  // Area, in square metres.
  { kind: "area", size: 1, names: ["m2", "m²", "sq m", "sqm", "square metre", "square metres", "square meter", "square meters"] },
  { kind: "area", size: 1e4, names: ["ha", "hectare", "hectares"] },
  {
    kind: "area",
    size: 1e6,
    names: ["km2", "km²", "sq km", "sqkm", "square kilometre", "square kilometres", "square kilometer", "square kilometers"],
  },
  { kind: "area", names: ["acre", "acres", "sq mi", "square mile", "square miles", "sq ft", "square foot", "square feet"] },
  // Volume, in millilitres.
  { kind: "volume", size: 1, names: ["ml", "millilitre", "millilitres", "milliliter", "milliliters"] },
  { kind: "volume", size: 10, names: ["cl", "centilitre", "centilitres", "centiliter", "centiliters"] },
  { kind: "volume", size: 1e3, names: ["l", "ltr", "litre", "litres", "liter", "liters"] },
  { kind: "volume", size: 1e6, names: ["m3", "m³", "cubic metre", "cubic metres", "cubic meter", "cubic meters"] },
  { kind: "volume", names: ["gal", "gallon", "gallons", "pint", "pints", "fl oz", "cup", "cups"] },
  // Mass, in milligrams.
  { kind: "mass", size: 1, names: ["mg", "milligram", "milligrams"] },
  { kind: "mass", size: 1e3, names: ["g", "gram", "grams", "gramme", "grammes"] },
  { kind: "mass", size: 1e6, names: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kilogrammes"] },
  { kind: "mass", size: 1e9, names: ["t", "tonne", "tonnes", "ton", "tons", "metric ton", "metric tons"] },
  { kind: "mass", names: ["lb", "lbs", "pound", "pounds", "oz", "ounce", "ounces"] },
  // Time, in seconds, up to a week.
  { kind: "time", size: 1, names: ["s", "sec", "secs", "second", "seconds"] },
  { kind: "time", size: 60, names: ["m", "min", "mins", "minute", "minutes"] },
  { kind: "time", size: 3600, names: ["h", "hr", "hrs", "hour", "hours"] },
  { kind: "time", size: 86400, names: ["d", "day", "days"] },
  { kind: "time", size: 604800, names: ["wk", "wks", "week", "weeks"] },
  // Months and years: twelve to a year, but no fixed number of days, so they don't convert into the units above.
  { kind: "calendar", size: 1, names: ["m", "mo", "mos", "month", "months"] },
  { kind: "calendar", size: 12, names: ["y", "yr", "yrs", "year", "years"] },
  // Speed, in metres per hour.
  {
    kind: "speed",
    size: 3600,
    names: ["m/s", "mps", "metre per second", "metres per second", "meter per second", "meters per second"],
  },
  {
    kind: "speed",
    size: 1e3,
    names: ["km/h", "km/hr", "kmh", "kph", "kmph", "kilometre per hour", "kilometres per hour", "kilometer per hour", "kilometers per hour"],
  },
  {
    kind: "speed",
    size: 3.6e6,
    names: ["km/s", "kilometre per second", "kilometres per second", "kilometer per second", "kilometers per second"],
  },
  { kind: "speed", names: ["mph", "mile per hour", "miles per hour", "knot", "knots"] },
  // Temperature: Celsius (the others don't convert by a factor).
  { kind: "temperature", size: 1, names: ["°c", "c", "deg c", "degree", "degrees", "deg", "celsius", "degree celsius", "degrees celsius"] },
  { kind: "temperature", names: ["°f", "f", "deg f", "fahrenheit", "degree fahrenheit", "degrees fahrenheit", "kelvin"] },
  // Food energy, and a few no question asks in but a player might type.
  { kind: "energy", size: 1, names: ["kcal", "cal", "calorie", "calories", "kilocalorie", "kilocalories"] },
  { kind: "percent", size: 1, names: ["%", "percent", "per cent"] },
  { kind: "rate", size: 1, names: ["bpm", "beats per minute"] },
  { kind: "power", size: 1, names: ["w", "watt", "watts"] },
];

/** Words that mean the same count ("8 billion persons" on a question in people). */
const COUNT_NAMES: readonly string[][] = [["people", "persons", "person"]];

/** The unit of measure a question is in, if it is one ("metres per second"); a count ("bones") isn't. */
const measureOf = (unit: string): Unit | undefined => {
  const u = unit.trim().toLowerCase();
  return UNITS.find((x) => x.names.includes(u));
};

/** Scale words a question's unit may start with, for big counts: "million people", "billion trees". */
const UNIT_SCALES: Record<string, number> = { million: 1e6, billion: 1e9, trillion: 1e12 };

/** A question's unit as its scale word and the unit after it: "billion trees" is 1e9 of "trees", "metres" 1 of itself. */
function splitScale(unit: string | undefined): { scale: number; base: string | undefined } {
  const m = (unit ?? "").trim().match(/^(million|billion|trillion)\s+(\S.*)$/i);
  return m ? { scale: UNIT_SCALES[m[1].toLowerCase()], base: m[2] } : { scale: 1, base: unit };
}

/** The question's own unit as a player may type it: a unit of measure, or a count by its plural and singular. */
function ownUnit(unit: string | undefined): Unit | undefined {
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return undefined;
  const measure = measureOf(u);
  if (measure) return measure;
  const names = new Set([u, u.replace(/s$/, ""), u.replace(/(?<=sh|ch|x|ss)es$/, "")]);
  for (const group of COUNT_NAMES) if (group.includes(u)) group.forEach((n) => names.add(n));
  return { kind: `count:${u}`, size: 1, names: [...names] };
}

/** The unit a name stands for on this question: its own unit first, then one of its kind, then any. */
function unitCalled(name: string, own: Unit | undefined): Unit | undefined {
  if (own?.names.includes(name)) return own;
  const all = UNITS.filter((u) => u.names.includes(name));
  return all.find((u) => u.kind === own?.kind) ?? all[0];
}

/**
 * What follows the digits: a scale word, a unit, or a scale word and then a unit ("k km"). A unit of the question's
 * kind beats a scale word ("0.5m" in centimetres is half a metre, "150t" in kilograms 150 tonnes), and a scale word
 * beats a unit of another kind ("330m" in people is 330 million). Null when it's neither.
 */
function readWords(rest: string, own: Unit | undefined): { scale: number; unit?: Unit } | null {
  if (!rest) return { scale: 1 };
  const sameKind = (u: Unit | undefined): u is Unit => !!u && (u === own || u.kind === own?.kind);
  const whole = unitCalled(rest, own);
  if (sameKind(whole)) return { scale: 1, unit: whole };
  if (SCALES[rest]) return { scale: SCALES[rest] };
  // A scale word, then a unit: "384k km", "2.5 million m", "390kkm2".
  const splits: { scale: number; unit: Unit }[] = [];
  for (let i = 1; i < rest.length; i++) {
    const scale = SCALES[rest.slice(0, i).trim()];
    const unit = scale ? unitCalled(rest.slice(i).trim(), own) : undefined;
    if (scale && unit) splits.push({ scale, unit });
  }
  const split = splits.find((s) => sameKind(s.unit));
  if (split) return split;
  // A unit of another kind: read, so the player can be asked for the question's own.
  if (whole) return { scale: 1, unit: whole };
  return splits[0] ?? null;
}

/** Float noise off a converted number: 498 s in minutes is 8.3, not 8.299999999999999. */
const clean = (n: number) => Number(n.toPrecision(12));

/**
 * What to say when a guess is in a unit the question isn't in: "In centimetres, please.", "In million people,
 * please.", or for a count "Just the number of bones."
 */
export function askFor(unit: string): string {
  const { scale, base } = splitScale(unit);
  return scale > 1 || measureOf(base ?? "") ? `In ${unit}, please.` : `Just the number of ${unit}.`;
}

/** Why a guess can't be read: `range` a percent past 0 to 100 or a year past four digits, `whole` a year with a fraction. */
export type NumberError = "empty" | "zero" | "negative" | "text" | "unit" | "range" | "whole";
/**
 * A number read, `converted` when what was typed wasn't in the question's unit: another unit of its kind ("0.5m" in
 * centimetres), or the whole amount on a question in a scaled unit ("8,800,000" in million people).
 */
export type NumberReading = { value: number; converted?: true } | { error: NumberError };

/** The digits part: "2,500,000", "2 500 000", "2.500.000", "1,5" (a decimal comma), "330", ".5", "2.5e6". */
function readDigits(s: string): number | null {
  // Thousands in groups of three: commas, spaces, or (two or more) dots.
  let m = s.match(/^(\d{1,3}(?:,\d{3})+)(\.\d+)?$/) ?? s.match(/^(\d{1,3}(?: \d{3})+)(\.\d+)?$/);
  if (m) return Number(m[1].replace(/[, ]/g, "") + (m[2] ?? ""));
  m = s.match(/^\d{1,3}(?:\.\d{3}){2,}$/);
  if (m) return Number(s.replace(/\./g, ""));
  // A comma that isn't a thousands separator is a decimal comma ("1,5"); one of them, digits on both sides.
  m = s.match(/^(\d+),(\d+)$/);
  if (m && m[2].length !== 3) return Number(`${m[1]}.${m[2]}`);
  if (/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/.test(s)) return Number(s);
  return null;
}

/**
 * Reads what a player typed as a number: "330", "2,500,000", "2.5m", "2.5 million", "1.5bn", "3k", "0.1", " 12 ".
 * `unit` is the question's unit: typed after the number it's just the unit ("330 metres", "330m" in metres, "343 m/s"),
 * and another unit of its kind is converted exactly ("1.5 km" in metres is 1,500). On a unit with a scale word
 * ("million people"), a number typed with a scale word or a unit, or one at least that big, is the whole amount and is
 * taken back to the unit's scale ("8.8 million", "8,800,000" and "8,800,000 people" are all 8.8). Says why when it
 * can't: nothing typed, zero, a negative, a unit the question isn't in (feet in metres, kilograms in bones), or not a
 * number at all.
 */
export function readNumber(text: string, unit?: string): NumberReading {
  let s = text
    .toLowerCase()
    .replace(/[   ]/g, " ")
    .replace(/[−–]/g, "-")
    .trim();
  if (!s) return { error: "empty" };
  // "about 300", "~300": the number is what counts.
  s = s.replace(/^(?:~|about|around|roughly|approx\.?|approximately|circa|c\.)\s*/, "");
  const m = s.match(/^([+-]?)\s*([\d.,\s]*\d(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|[\d.]+)(.*)$/);
  if (!m) return { error: "text" };
  const [, sign, digits, after] = m;
  const n = readDigits(digits.trim());
  const { scale, base } = splitScale(unit);
  const own = ownUnit(base);
  // What follows, tidied: one space between words, "° c" as "°c", an abbreviation's full stop off ("330 m.").
  const rest = after.trim().replace(/\s+/g, " ").replace(/°\s/, "°").replace(/\.$/, "");
  const words = readWords(rest, own);
  if (n === null || !words) return { error: "text" };
  let value = n * words.scale;
  if (!Number.isFinite(value)) return { error: "text" };
  if (value === 0) return { error: "zero" };
  if (sign === "-") return { error: "negative" };
  const typed = words.unit;
  const other = !!typed && typed !== own;
  if (other && (typed.kind !== own?.kind || !typed.size || !own.size)) return { error: "unit" };
  if (other) value = (value * typed.size!) / own!.size!;
  if (scale > 1 && (words.scale > 1 || typed || value >= scale)) return { value: clean(value / scale), converted: true };
  return other ? { value: clean(value), converted: true } : { value };
}

/** The number in what was typed, or null when there isn't a positive one. */
export function parseNumber(text: string, unit?: string): number | null {
  const r = readNumber(text, unit);
  return "value" in r ? r.value : null;
}

/** The latest year a guess can be: four digits. */
export const MAX_YEAR = 9999;

/**
 * Reads a guess on a question, by its round. An estimate as readNumber reads it, in the question's unit. A percent from
 * 0 to 100, with or without its sign ("71", "71%", "71.5", "71 percent"): 0 is a fair guess at a share. A year as a
 * whole AD year of up to four digits ("2007", "AD 2007", "c. 1900"); a fraction of one is `whole`, five digits `range`.
 */
export function readGuess(text: string, q: Pick<FathomQuestion, "round" | "unit">): NumberReading {
  const round = roundOf(q);
  if (round === "percent") {
    const r = readNumber(text, ROUND_UNITS.percent);
    if ("error" in r) return r.error === "zero" ? { value: 0 } : r.error === "negative" ? { error: "range" } : r;
    return r.value > 100 ? { error: "range" } : { value: r.value };
  }
  if (round === "year") {
    const bare = text
      .trim()
      .replace(/^(?:ad|a\.d\.|ce)\s*/i, "")
      .replace(/\s*(?:ad|a\.d\.|ce|c\.e\.)$/i, "");
    const r = readNumber(bare);
    if ("error" in r) return r.error === "unit" ? { error: "text" } : r;
    if (r.value > MAX_YEAR) return { error: "range" };
    return Number.isInteger(r.value) ? { value: r.value } : { error: "whole" };
  }
  return readNumber(text, q.unit);
}

/** What's wrong with a guess, in one line at 320px: the round's own words ("A whole year, please."). */
export function guessError(error: NumberError, q: Pick<FathomQuestion, "round" | "unit">): string {
  const round = roundOf(q);
  if (error === "unit") return askFor(q.unit);
  if (round === "year") {
    if (error === "empty") return "Type a year first.";
    if (error === "text") return "That doesn't read as a year.";
    if (error === "whole") return "A whole year, please.";
    if (error === "range") return "A year has four digits.";
  }
  if (round === "percent" && error === "range") return "0 to 100, please.";
  const plain: Record<Exclude<NumberError, "unit">, string> = {
    empty: "Type a number first.",
    zero: "Has to be more than zero.",
    negative: "No negatives. It's above zero.",
    text: "That doesn't read as a number.",
    range: "That doesn't read as a number.",
    whole: "That doesn't read as a number.",
  };
  return plain[error];
}

/* ---------- The field ---------- */

/** "8800000" as "8,800,000", "1234.5" as "1,234.5": the leading digits in groups of three, anything after as typed. */
export function groupDigits(text: string): string {
  const m = text.match(/^(\d+)([^]*)$/);
  // Not "2.5e6": an exponent's digits aren't the number's.
  if (!m || /^(?:\.\d*)?e/i.test(m[2])) return text;
  return m[1].replace(/\B(?=(?:\d{3})+$)/g, ",") + m[2];
}

/** What an edit put in: the part of `next` that isn't the start or the end it shares with `prev`. */
function inserted(prev: string, next: string): string {
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  return next.slice(a, next.length - b);
}

/**
 * The guess field after an edit, grouped as it's typed: `prev` is what it showed, `next` what the edit made of it, and
 * `caret` where the caret is in `next`. The field's own commas come off and the digits are grouped again, the caret
 * kept after the same digit ("8,800,00|" and a 0 is "8,800,000|"). A comma the player types is theirs: the field
 * then shows what they type as typed until it's gone, since it may be a decimal comma ("2,5" from a keypad whose only
 * separator is a comma), which readNumber reads. A year is never grouped: it shows as typed ("2007", not "2,007").
 */
export function editField(prev: string, next: string, caret: number, round: Round = "estimate"): { text: string; caret: number } {
  if (round === "year") return { text: next, caret };
  const ours = !prev.includes(",") || groupDigits(prev.replace(/,/g, "")) === prev;
  if (!ours || inserted(prev, next).includes(",")) return { text: next, caret };
  const text = groupDigits(next.replace(/,/g, ""));
  const before = next.slice(0, caret).replace(/,/g, "").length;
  let at = 0;
  for (let seen = 0; at < text.length && seen < before; at++) if (text[at] !== ",") seen++;
  return { text, caret: at };
}

/** "2,500,000", "0.1", "8,848.86" (up to 10 significant digits, so 1.1 x 1000 reads 1,100, and 3 decimals). */
export function formatDigits(n: number): string {
  // At most 3 decimals: "8.804", never "8.80419" (the review, Nov 9: New York City in million people); 42.195 as it is.
  // A number under a hundredth keeps two significant digits instead, so a tiny guess never reads as 0 ("0.0001").
  const small = n !== 0 && Math.abs(n) < 0.01;
  const decimals = small ? Math.ceil(-Math.log10(Math.abs(n))) + 1 : 3;
  return Number(n.toFixed(decimals)).toLocaleString("en-US", { maximumSignificantDigits: 10 });
}

/**
 * A column of figures written one way (the reveal's best answers): in words when every one is a million or more ("49.8
 * million"), else in digits ("996,600", "1,067,000"), never a mix of the two.
 */
export function formatColumn(values: readonly number[]): string[] {
  if (values.length && values.every((v) => v >= 1e6)) return values.map(formatWords);
  return values.map((v) => formatDigits(v >= 1000 ? Math.round(v) : v));
}

const WORDS: readonly [number, string][] = [
  [1e12, "trillion"],
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
];

/**
 * "2.5 million", "12.35 thousand", "330" (4 significant digits at most; plain digits under a thousand). Past a
 * thousand trillion, the power of ten: "3e18".
 */
export function formatWords(n: number): string {
  if (n >= 1e15) {
    const e = Math.floor(Math.log10(n));
    return `${+(n / 10 ** e).toPrecision(4)}e${e}`;
  }
  for (const [size, word] of WORDS) {
    if (n >= size * 0.99995) return `${(n / size).toLocaleString("en-US", { maximumSignificantDigits: 4 })} ${word}`;
  }
  return formatDigits(n);
}

/**
 * A number as the reveal and the results show it: digits up to a million, words from there ("8.1 billion"). Past a
 * thousand, whole units ("299,792", not "299,792.458").
 */
export function formatAmount(n: number): string {
  if (n >= 1e6) return formatWords(n);
  return formatDigits(n >= 1000 ? Math.round(n) : n);
}

/**
 * A guess or an answer as the reveal and the results show it, in its round's terms: as the big number and the unit
 * beside it for an estimate ("8.8", "million people"), a percent with its sign ("71%"), a year as typed ("2007", never
 * "2,007").
 */
export function figureParts(q: Pick<FathomQuestion, "round" | "unit">, n: number): { n: string; unit?: string } {
  const round = roundOf(q);
  if (round === "percent") return { n: `${formatDigits(n)}%` };
  if (round === "year") return { n: String(n) };
  // A name-it round's figure in its list's measure, one of it singular: "1 land border".
  if (round === "name") return { n: formatAmount(n), unit: n === 1 ? singular(q.unit) : q.unit };
  return { n: formatAmount(n), unit: q.unit };
}

/** The same, in one piece: "8.8 million people", "71%", "2007". */
export function amountText(q: Pick<FathomQuestion, "round" | "unit">, n: number): string {
  const f = figureParts(q, n);
  return f.unit ? `${f.n} ${f.unit}` : f.n;
}

/** What shows beside the field: the unit ("metres", "million people", "year"), a percent's sign; nothing for a name. */
export const unitShown = (q: Pick<FathomQuestion, "round" | "unit">): string =>
  roundOf(q) === "percent" ? "%" : roundOf(q) === "name" ? "" : q.unit;

/* ---------- The bank ---------- */

const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

/** One question from the file, if it is well formed (anything else is left out, not fatal). */
function readQuestion(q: unknown): FathomQuestion | null {
  if (!q || typeof q !== "object") return null;
  const o = q as Record<string, unknown>;
  const src = o.source as Record<string, unknown> | undefined;
  // A name-it question takes its unit, answer and source from its list: src/game/fathom-name.ts reads it with that.
  if (o.round === "name") return null;
  if (!isText(o.id) || !isText(o.question) || !isText(o.unit) || !isText(o.fact)) return null;
  if (!(FATHOM_KINDS as readonly unknown[]).includes(o.kind)) return null;
  if (typeof o.answer !== "number" || !Number.isFinite(o.answer) || o.answer <= 0) return null;
  if (!src || !isText(src.title) || !isText(src.url)) return null;
  // A round the game can't play (a newer bank's), or an answer outside its round's range, is left out.
  if (o.round !== undefined && !(ROUNDS as readonly unknown[]).includes(o.round)) return null;
  const round = o.round as Round | undefined;
  if (round === "percent" && o.answer > 100) return null;
  if (round === "year" && (!Number.isInteger(o.answer) || o.answer > MAX_YEAR)) return null;
  // `typical` is the writers' (scripts/fathom/check.ts checks it); the game leaves it out.
  return {
    id: o.id,
    kind: o.kind as FathomKind,
    ...(round && { round }),
    question: o.question,
    unit: o.unit,
    answer: o.answer,
    ...(isText(o.definition) && { definition: o.definition }),
    fact: o.fact,
    source: { title: src.title, url: src.url },
    ...(o.easy === true && { easy: true }),
  };
}

/**
 * The number questions in a bank file (`public/fathom/questions.json`): the well-formed ones, each id once. Null when
 * it isn't a bank at all (missing, HTML, another shape). Name-it questions need their lists: readFullBank in
 * src/game/fathom-name.ts adds them.
 */
export function readBank(json: unknown): FathomQuestion[] | null {
  if (!json || typeof json !== "object" || !Array.isArray((json as FathomBank).questions)) return null;
  const seen = new Set<string>();
  const out: FathomQuestion[] = [];
  for (const raw of (json as FathomBank).questions) {
    const q = readQuestion(raw);
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

/**
 * A game's rounds: two estimates, a percent, a year, and a name-it round (an estimate when the bank has none, or its
 * lists didn't load). Drawn in a mixed order, an easy question first.
 */
export const GAME_ROUNDS: readonly Round[] = ["estimate", "estimate", "percent", "year", "name"];

/**
 * Five questions for a game, one per round of GAME_ROUNDS: the first one easy (and a number to type: never the name-it
 * round, which is the odd one out), then the rest in a random order. A round the bank has none of is played as an
 * estimate instead (and once the estimates run out, anything left). Within that: no two of the same kind, at most
 * MAX_SIZE_PER_GAME how tall / how heavy questions, and none from the last HOLD_GAMES games (`recent`, newest first)
 * while the bank has others. When it doesn't, the questions from the oldest of those games come back first; a bank too
 * small for five kinds repeats a kind rather than come up short, and one of nothing but how tall / how heavy questions
 * takes more of them.
 */
export function drawQuestions(
  questions: readonly FathomQuestion[],
  recent: readonly (readonly string[])[] = [],
  rand: () => number = Math.random,
): FathomQuestion[] {
  // How recently each question was played: 0 never (in the last games), the most in the last one.
  const held = recent.slice(0, HOLD_GAMES);
  const tier = new Map<string, number>();
  held.forEach((ids, i) => ids.forEach((id) => tier.has(id) || tier.set(id, held.length - i)));
  const key = new Map(questions.map((q) => [q.id, rand()]));
  const order = (a: FathomQuestion, b: FathomQuestion) =>
    (tier.get(a.id) ?? 0) - (tier.get(b.id) ?? 0) || key.get(a.id)! - key.get(b.id)!;
  const pool = [...questions].sort(order);

  const number = (q: FathomQuestion) => roundOf(q) !== "name";
  const first = pool.find((q) => q.easy && number(q)) ?? pool.find(number) ?? pool[0];
  if (!first) return [];
  const picked: FathomQuestion[] = [first];

  // The rounds still to fill: the shape, less the opener's round (or an estimate, if the opener's round isn't in it).
  const slots = GAME_ROUNDS.map((r) => (pool.some((q) => roundOf(q) === r) ? r : "estimate"));
  const at = slots.indexOf(roundOf(first));
  slots.splice(at >= 0 ? at : slots.indexOf("estimate"), 1);
  // The rarer rounds first, so one isn't lost to a kind an estimate already took.
  slots.sort((a, b) => Number(a === "estimate") - Number(b === "estimate"));

  const sizes = () => picked.filter(isSizeQuestion).length;
  /** The first question left in the pool that `fits`: of a new kind and within the cap, else within the cap, else any. */
  const pick = (fits: (q: FathomQuestion) => boolean) => {
    const left = pool.filter((q) => !picked.includes(q) && fits(q));
    const kinds = new Set(picked.map((q) => q.kind));
    const capped = left.filter((q) => !isSizeQuestion(q) || sizes() < MAX_SIZE_PER_GAME);
    return capped.find((q) => !kinds.has(q.kind)) ?? capped[0] ?? left[0];
  };
  for (const round of slots) {
    const next = pick((q) => roundOf(q) === round) ?? pick((q) => roundOf(q) === "estimate") ?? pick(() => true);
    if (!next) break;
    picked.push(next);
  }

  // A mixed order after the opener.
  const rest = picked.slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest].slice(0, QUESTIONS_PER_GAME);
}

/* ---------- A game ---------- */

export interface FathomGame {
  /** The five questions, by id, in order. */
  ids: string[];
  /**
   * The locked-in guesses, in order. A name-it round's is the figure of the thing named (its population), which is
   * what scores; the name itself is in `picks`.
   */
  guesses: number[];
  /**
   * The question on screen (0-4); it is revealed once it has a guess (guesses.length > at). At 5 the results show.
   */
  at: number;
  /** What was named on a name-it round, by question id: "Colombia". */
  picks?: Record<string, string>;
  /** Epoch ms it was drawn: the game's id in Past runs and the sync. Older saves lack it. */
  startedAt?: number;
}

export const newGame = (ids: string[], startedAt?: number): FathomGame => ({ ids, guesses: [], at: 0, ...(startedAt !== undefined && { startedAt }) });

export type FathomPhase = "question" | "reveal" | "results";

export function phaseOf(game: FathomGame): FathomPhase {
  if (game.at >= game.ids.length) return "results";
  return game.guesses.length > game.at ? "reveal" : "question";
}

/** Locks in a guess for the question on screen (once); on a name-it round, `pick` is the name, `guess` its figure. */
export function lockIn(game: FathomGame, guess: number, pick?: string): FathomGame {
  if (phaseOf(game) !== "question") return game;
  const picks = pick === undefined ? game.picks : { ...game.picks, [game.ids[game.at]]: pick };
  return { ...game, guesses: [...game.guesses, guess], ...(picks && { picks }) };
}

/** From a revealed question to the next one, or to the results after the last. */
export function nextQuestion(game: FathomGame): FathomGame {
  if (phaseOf(game) !== "reveal") return game;
  return { ...game, at: game.at + 1 };
}

export interface Scored {
  question: FathomQuestion;
  guess: number;
  points: number;
  band: Band;
  /** A name-it round's: what was named. */
  pick?: string;
}

/** Each answered question with its points and band. */
export function scoreGame(game: FathomGame, bank: readonly FathomQuestion[]): Scored[] {
  const byId = new Map(bank.map((q) => [q.id, q]));
  return game.guesses.flatMap((guess, i) => {
    const question = byId.get(game.ids[i]);
    if (!question) return [];
    const points = scoreFor(question, guess);
    const pick = game.picks?.[question.id];
    return [{ question, guess, points, band: bandOf(points), ...(pick !== undefined && { pick }) }];
  });
}

export const totalOf = (scored: readonly Scored[]): number => scored.reduce((sum, s) => sum + s.points, 0);

/** One square per band for the share text, in the band's colour on the results. */
export const BAND_CHARS: Record<Band, string> = {
  // The squares a list's share uses where the colours match (gold, cyan, a miss), and the nearest for the others: the
  // results' periwinkle and pink. Lost at sea is a dark square, as a list's miss, never an empty box (it read as a
  // question not played).
  "dead-on": "🟨",
  close: "🟦",
  near: "🟪",
  far: "🟥",
  lost: "⬛",
};

/**
 * SHARE: "Fathom #12 312/500" for a day's Fathom (`n`, its number), "Fathom 312/500" for an endless game, the five bands
 * as squares, and the link (`url`, to #fathom) when there is one, each on its own line (the screen makes the lines keep
 * in a Reddit comment: src/components/share.ts pasteable).
 */
export function shareText(scored: readonly Scored[], url?: string, n?: number): string {
  return shareLines(totalOf(scored), scored.map((s) => s.band), url, n);
}

/** The share text from a total and the bands (a past game keeps its points, not always its questions). */
export function shareLines(total: number, bands: readonly Band[], url?: string, n?: number): string {
  return [`Fathom${n ? ` #${n}` : ""} ${total}/${MAX_TOTAL}`, bands.map((b) => BAND_CHARS[b]).join(" "), ...(url ? [url] : [])].join("\n");
}

/* ---------- The save (its own key) ---------- */

export { FATHOM_KEY };

export interface FathomSave {
  /** The question ids of the last HOLD_GAMES games, newest first (held back from the next draw). */
  recent: string[][];
  /** The game on screen, so a reload picks it up where it was. */
  game?: FathomGame;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): Store | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const isIds = (x: unknown): x is string[] => Array.isArray(x) && x.every((id) => typeof id === "string");

/** A save's picks: names (strings) by the game's own question ids. */
function readPicks(x: unknown, ids: string[]): Record<string, string> | undefined {
  if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
  const out = Object.fromEntries(Object.entries(x).filter(([id, name]) => ids.includes(id) && typeof name === "string" && name.trim()));
  return Object.keys(out).length ? out : undefined;
}

/** The save, or an empty one (nothing stored, junk, blocked storage). */
export function loadFathom(store: Store | undefined = defaultStore()): FathomSave {
  try {
    const raw = JSON.parse(store?.getItem(FATHOM_KEY) ?? "null") as Partial<FathomSave> | null;
    const recent = Array.isArray(raw?.recent) ? raw.recent.filter(isIds).slice(0, HOLD_GAMES) : [];
    const g = raw?.game;
    const ok = g && isIds(g.ids) && Array.isArray(g.guesses) && g.guesses.every((n) => Number.isFinite(n) && n >= 0) && Number.isInteger(g.at);
    const picks = ok ? readPicks(g.picks, g.ids) : undefined;
    const startedAt = ok && Number.isFinite(g.startedAt) ? g.startedAt : undefined;
    const game = ok ? { ids: g.ids, guesses: g.guesses, at: g.at, ...(picks && { picks }), ...(startedAt !== undefined && { startedAt }) } : undefined;
    return { recent, ...(game && { game }) };
  } catch {
    return { recent: [] };
  }
}

export function saveFathom(save: FathomSave, store: Store | undefined = defaultStore()): void {
  try {
    store?.setItem(FATHOM_KEY, JSON.stringify(save));
  } catch {
    // Not kept: the game still plays, and the next draw just can't hold these questions back.
  }
}

/**
 * A fresh game from the bank, drawn at `now`, its questions remembered so the next few draws hold them back (the screen
 * also notes the draw in the player's save, noteDraw in fathom-history.ts, so other devices hold them back too).
 */
export function startGame(save: FathomSave, bank: readonly FathomQuestion[], rand: () => number = Math.random, now: number = Date.now()): FathomSave {
  const ids = drawQuestions(bank, save.recent, rand).map((q) => q.id);
  return { recent: [ids, ...save.recent].slice(0, HOLD_GAMES), game: newGame(ids, now) };
}

/** Whether every question of the game has its guess: its total is final (the last reveal or the results). */
export const finished = (game: FathomGame): boolean => game.ids.length > 0 && game.guesses.length >= game.ids.length;

/**
 * The saved game, if it can be shown with this bank (its questions all still there): an unfinished one goes on, and a
 * finished one reopens on its results, so a reload never loses a score. Only NEW QUESTIONS draws again.
 */
export function resumable(save: FathomSave, bank: readonly FathomQuestion[]): FathomGame | undefined {
  const g = save.game;
  if (!g || g.guesses.length > g.ids.length) return undefined;
  const ids = new Set(bank.map((q) => q.id));
  return g.ids.length === QUESTIONS_PER_GAME && g.ids.every((id) => ids.has(id)) && g.at <= g.guesses.length ? g : undefined;
}
