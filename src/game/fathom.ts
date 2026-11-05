/**
 * Fathom (beta, #fathom): five questions that each ask for a number, about two minutes, no timer, no lives. A guess
 * scores by how far off it is on a log scale, against how far off people typically are on that question.
 *
 * Pure functions only: reading numbers, scoring, the draw, the share text, and the save (its own localStorage key,
 * never the game's save: Fathom touches no record, stat, streak or backend).
 */

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

/** The typical miss on a question, as a ratio (2: people are usually about 2x off). */
export const TYPICALS = [1.3, 1.5, 2, 3, 5, 10, 30] as const;

export interface FathomQuestion {
  id: string;
  kind: FathomKind;
  question: string;
  /** Shown beside the input and with the answer: "metres". */
  unit: string;
  answer: number;
  /** What exactly is measured: "to the tip of its antenna". */
  definition?: string;
  fact: string;
  source: { title: string; url: string };
  typical: number;
  /** The first question of a game is always an easy one. */
  easy?: boolean;
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
 * Points for a guess, 0 to 100. With d = |log10(guess / answer)| and m = log10(typical):
 * 100 x (1 - (2/pi) atan(d / m)), rounded. Spot on (within 1%) is 100 and only spot on is (anything else tops out at
 * 99), a miss as big as the typical one is 50, twice that about 30, and it never quite reaches 0.
 */
export function fathomScore(guess: number, answer: number, typical: number): number {
  if (spotOn(guess, answer)) return POINTS_PER_QUESTION;
  const d = Math.abs(Math.log10(guess / answer));
  const m = Math.log10(typical);
  if (!Number.isFinite(d) || !(m > 0)) return 0;
  return Math.min(POINTS_PER_QUESTION - 1, Math.round(POINTS_PER_QUESTION * (1 - (2 / Math.PI) * Math.atan(d / m))));
}

/** What a miss as big as the question's typical one scores, whatever the question: the yardstick. */
export const TYPICAL_POINTS = 50;
/** A typical guesser's total: a typical miss on every question. */
export const TYPICAL_TOTAL = QUESTIONS_PER_GAME * TYPICAL_POINTS;

export type Band = "dead-on" | "close" | "near" | "far" | "lost";

/** Bands by score, best first: the least score each one takes. */
export const BANDS: readonly { band: Band; label: string; min: number }[] = [
  { band: "dead-on", label: "Dead on", min: 90 },
  { band: "close", label: "Close", min: 70 },
  { band: "near", label: "Near", min: 40 },
  { band: "far", label: "Far", min: 15 },
  { band: "lost", label: "Lost at sea", min: 0 },
];

export function bandOf(score: number): Band {
  return (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]).band;
}

export const bandLabel = (band: Band): string => BANDS.find((b) => b.band === band)?.label ?? band;

/**
 * How far the guess is from the answer on the log scale (d = |log10(guess / answer)|) where a score crosses `min`:
 * the inverse of fathomScore, for drawing the bands. Infinity for 0 (the score never gets there).
 */
export function bandEdge(min: number, typical: number): number {
  if (min <= 0) return Infinity;
  return Math.log10(typical) * Math.tan(((1 - min / POINTS_PER_QUESTION) * Math.PI) / 2);
}

/** A ratio for "Nx too high": 1.05, 1.3, 2, 12, 1,500, 3 million. */
function ratioText(r: number): string {
  if (r < 1.095) return trimZeros(r.toFixed(2));
  if (r < 9.95) return trimZeros(r.toFixed(1));
  if (r < 1e6) return Math.round(r).toLocaleString("en-US");
  return formatWords(r);
}
const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** "1.3x", "12x", "3 million times". A plain x, not the times sign: the pixel font has no "×", and a fallback glyph stood out. */
function times(r: number): string {
  const t = ratioText(r);
  return /[a-z]$/.test(t) ? `${t} times` : `${t}x`;
}

/** "1.3x too high", "2.4x too low", "3 million times too low", or "spot on" within 1%. */
export function timesOff(guess: number, answer: number): string {
  if (spotOn(guess, answer)) return "spot on";
  return guess > answer ? `${times(guess / answer)} too high` : `${times(answer / guess)} too low`;
}

/**
 * The yardstick under "1.3x too low" on the reveal: the question's typical miss, which scores 50 ("most people miss by
 * about 2x"). Points are relative to it, so without it a near miss on one question and a farther one on another look
 * arbitrary.
 */
export const missText = (typical: number): string => `most people miss by about ${times(typical)}`;

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
 * What to say when a guess is in a unit the question isn't in: "In centimetres, please.", or for a count "Just the
 * number of bones."
 */
export function askFor(unit: string): string {
  return measureOf(unit) ? `In ${unit}, please.` : `Just the number of ${unit}.`;
}

export type NumberError = "empty" | "zero" | "negative" | "text" | "unit";
/** A number read, `converted` when it was typed in another unit of the question's kind ("0.5m" in centimetres). */
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
 * and another unit of its kind is converted exactly ("1.5 km" in metres is 1,500). Says why when it can't: nothing
 * typed, zero, a negative, a unit the question isn't in (feet in metres, kilograms in bones), or not a number at all.
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
  const own = ownUnit(unit);
  // What follows, tidied: one space between words, "° c" as "°c", an abbreviation's full stop off ("330 m.").
  const rest = after.trim().replace(/\s+/g, " ").replace(/°\s/, "°").replace(/\.$/, "");
  const words = readWords(rest, own);
  if (n === null || !words) return { error: "text" };
  let value = n * words.scale;
  if (!Number.isFinite(value)) return { error: "text" };
  if (value === 0) return { error: "zero" };
  if (sign === "-") return { error: "negative" };
  const typed = words.unit;
  if (!typed || typed === own) return { value };
  if (typed.kind !== own?.kind || !typed.size || !own.size) return { error: "unit" };
  value = clean((value * typed.size) / own.size);
  return { value, converted: true };
}

/** The number in what was typed, or null when there isn't a positive one. */
export function parseNumber(text: string, unit?: string): number | null {
  const r = readNumber(text, unit);
  return "value" in r ? r.value : null;
}

/** What a multiplier key multiplies by. */
export const MULTIPLIERS = [
  { id: "thousand", label: "Thousand", factor: 1e3 },
  { id: "million", label: "Million", factor: 1e6 },
  { id: "billion", label: "Billion", factor: 1e9 },
] as const;
export type MultiplierId = (typeof MULTIPLIERS)[number]["id"];

/** "2,500,000", "0.1", "8,848.86" (up to 10 significant digits, so 1.1 x 1000 reads 1,100). */
export function formatDigits(n: number): string {
  return n.toLocaleString("en-US", { maximumSignificantDigits: 10 });
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
 * The echo under the field: "2,500,000 · 2.5 million", just "330" under a thousand, and just the words from a
 * trillion ("3.04 trillion", "3e18"), whose digits would run past a narrow phone's line.
 */
export function echoText(n: number): string {
  if (n >= 1e12 * 0.99995) return formatWords(n);
  return n >= 1000 ? `${formatDigits(n)} · ${formatWords(n)}` : formatDigits(n);
}

/**
 * A number as the reveal and the results show it: digits up to a million, words from there ("8.1 billion"). Past a
 * thousand, whole units ("299,792", not "299,792.458").
 */
export function formatAmount(n: number): string {
  if (n >= 1e6) return formatWords(n);
  return formatDigits(n >= 1000 ? Math.round(n) : n);
}

/* ---------- The bank ---------- */

const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

/** One question from the file, if it is well formed (anything else is left out, not fatal). */
function readQuestion(q: unknown): FathomQuestion | null {
  if (!q || typeof q !== "object") return null;
  const o = q as Record<string, unknown>;
  const src = o.source as Record<string, unknown> | undefined;
  if (!isText(o.id) || !isText(o.question) || !isText(o.unit) || !isText(o.fact)) return null;
  if (!(FATHOM_KINDS as readonly unknown[]).includes(o.kind)) return null;
  if (typeof o.answer !== "number" || !Number.isFinite(o.answer) || o.answer <= 0) return null;
  if (typeof o.typical !== "number" || !Number.isFinite(o.typical) || o.typical <= 1) return null;
  if (!src || !isText(src.title) || !isText(src.url)) return null;
  return {
    id: o.id,
    kind: o.kind as FathomKind,
    question: o.question,
    unit: o.unit,
    answer: o.answer,
    ...(isText(o.definition) && { definition: o.definition }),
    fact: o.fact,
    source: { title: src.title, url: src.url },
    typical: o.typical,
    ...(o.easy === true && { easy: true }),
  };
}

/**
 * The questions in a bank file (`public/fathom/questions.json`): the well-formed ones, each id once. Null when it
 * isn't a bank at all (missing, HTML, another shape).
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

/** Games whose questions are held back from the next draw. */
export const HOLD_GAMES = 3;

/**
 * Five questions for a game: no two of the same kind, the first one easy, and none from the last HOLD_GAMES games
 * (`recent`, newest first) while the bank has others. When it doesn't, the questions from the oldest of those games
 * come back first; a bank too small for five kinds repeats a kind rather than come up short.
 */
export function drawQuestions(
  questions: readonly FathomQuestion[],
  recent: readonly (readonly string[])[] = [],
  rand: () => number = Math.random,
): FathomQuestion[] {
  // How recently each question was played: 0 never (in the last games), HOLD_GAMES in the last one.
  const tier = new Map<string, number>();
  recent.slice(0, HOLD_GAMES).forEach((ids, i) => ids.forEach((id) => tier.has(id) || tier.set(id, HOLD_GAMES - i)));
  const key = new Map(questions.map((q) => [q.id, rand()]));
  const order = (a: FathomQuestion, b: FathomQuestion) =>
    (tier.get(a.id) ?? 0) - (tier.get(b.id) ?? 0) || key.get(a.id)! - key.get(b.id)!;
  const pool = [...questions].sort(order);

  const picked: FathomQuestion[] = [];
  const first = pool.find((q) => q.easy) ?? pool[0];
  if (!first) return [];
  picked.push(first);
  while (picked.length < QUESTIONS_PER_GAME) {
    const left = pool.filter((q) => !picked.includes(q));
    if (!left.length) break;
    const kinds = new Set(picked.map((q) => q.kind));
    picked.push(left.find((q) => !kinds.has(q.kind)) ?? left[0]);
  }
  return picked;
}

/* ---------- A game ---------- */

export interface FathomGame {
  /** The five questions, by id, in order. */
  ids: string[];
  /** The locked-in guesses, in order. */
  guesses: number[];
  /**
   * The question on screen (0-4); it is revealed once it has a guess (guesses.length > at). At 5 the results show.
   */
  at: number;
}

export const newGame = (ids: string[]): FathomGame => ({ ids, guesses: [], at: 0 });

export type FathomPhase = "question" | "reveal" | "results";

export function phaseOf(game: FathomGame): FathomPhase {
  if (game.at >= game.ids.length) return "results";
  return game.guesses.length > game.at ? "reveal" : "question";
}

/** Locks in a guess for the question on screen (once). */
export function lockIn(game: FathomGame, guess: number): FathomGame {
  if (phaseOf(game) !== "question") return game;
  return { ...game, guesses: [...game.guesses, guess] };
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
}

/** Each answered question with its points and band. */
export function scoreGame(game: FathomGame, bank: readonly FathomQuestion[]): Scored[] {
  const byId = new Map(bank.map((q) => [q.id, q]));
  return game.guesses.flatMap((guess, i) => {
    const question = byId.get(game.ids[i]);
    if (!question) return [];
    const points = fathomScore(guess, question.answer, question.typical);
    return [{ question, guess, points, band: bandOf(points) }];
  });
}

export const totalOf = (scored: readonly Scored[]): number => scored.reduce((sum, s) => sum + s.points, 0);

/** One plain character per band for the share text (no emoji): fuller is closer. */
export const BAND_CHARS: Record<Band, string> = {
  "dead-on": "█",
  close: "▓",
  near: "▒",
  far: "░",
  // A cross, not an empty box: an empty box read as a question not played.
  lost: "×",
};

/** COPY RESULT: "Fathom beta 312/500" and the five bands as plain characters. */
export function shareText(scored: readonly Scored[]): string {
  return `Fathom beta ${totalOf(scored)}/${MAX_TOTAL}\n${scored.map((s) => BAND_CHARS[s.band]).join(" ")}`;
}

/* ---------- The save (its own key) ---------- */

export const FATHOM_KEY = "tentacle:fathom";

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

/** The save, or an empty one (nothing stored, junk, blocked storage). */
export function loadFathom(store: Store | undefined = defaultStore()): FathomSave {
  try {
    const raw = JSON.parse(store?.getItem(FATHOM_KEY) ?? "null") as Partial<FathomSave> | null;
    const recent = Array.isArray(raw?.recent) ? raw.recent.filter(isIds).slice(0, HOLD_GAMES) : [];
    const g = raw?.game;
    const game =
      g && isIds(g.ids) && Array.isArray(g.guesses) && g.guesses.every((n) => typeof n === "number" && n > 0) && Number.isInteger(g.at)
        ? { ids: g.ids, guesses: g.guesses, at: g.at }
        : undefined;
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

/** A fresh game from the bank, its questions remembered so the next few draws hold them back. */
export function startGame(save: FathomSave, bank: readonly FathomQuestion[], rand: () => number = Math.random): FathomSave {
  const ids = drawQuestions(bank, save.recent, rand).map((q) => q.id);
  return { recent: [ids, ...save.recent].slice(0, HOLD_GAMES), game: newGame(ids) };
}

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
