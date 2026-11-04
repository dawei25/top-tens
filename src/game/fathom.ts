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

/**
 * Points for a guess, 0 to 100. With d = |log10(guess / answer)| and m = log10(typical):
 * 100 x (1 - (2/pi) atan(d / m)), rounded. Exact is 100, a miss as big as the typical one is 50, twice that about 30,
 * and it never quite reaches 0.
 */
export function fathomScore(guess: number, answer: number, typical: number): number {
  const d = Math.abs(Math.log10(guess / answer));
  const m = Math.log10(typical);
  if (!Number.isFinite(d) || !(m > 0)) return 0;
  return Math.round(POINTS_PER_QUESTION * (1 - (2 / Math.PI) * Math.atan(d / m)));
}

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

/**
 * "1.3x too high", "2.4x too low", "3 million times too low", or "spot on" within 1%. A plain x, not the times sign:
 * the pixel font has no "×", and a fallback glyph stood out.
 */
export function timesOff(guess: number, answer: number): string {
  if (Math.abs(guess - answer) <= Math.abs(answer) * 0.01) return "spot on";
  const times = (r: number) => {
    const t = ratioText(r);
    return /[a-z]$/.test(t) ? `${t} times` : `${t}x`;
  };
  return guess > answer ? `${times(guess / answer)} too high` : `${times(answer / guess)} too low`;
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
 * Units that mean the same thing, so a unit typed after the number is read as the unit ("330m" on a question in
 * metres is 330 metres, not 330 million). Lowercase.
 */
const UNIT_GROUPS: readonly string[][] = [
  ["m", "metre", "metres", "meter", "meters"],
  ["km", "kms", "kilometre", "kilometres", "kilometer", "kilometers"],
  ["cm", "centimetre", "centimetres", "centimeter", "centimeters"],
  ["mm", "millimetre", "millimetres", "millimeter", "millimeters"],
  ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kilogrammes"],
  ["g", "gram", "grams", "gramme", "grammes"],
  ["t", "tonne", "tonnes", "ton", "tons"],
  ["l", "litre", "litres", "liter", "liters"],
  ["ml", "millilitre", "millilitres", "milliliter", "milliliters"],
  ["s", "sec", "secs", "second", "seconds"],
  ["min", "mins", "minute", "minutes"],
  ["h", "hr", "hrs", "hour", "hours"],
  ["d", "day", "days"],
  ["y", "yr", "yrs", "year", "years"],
  ["mi", "mile", "miles"],
  ["ft", "foot", "feet"],
  ["in", "inch", "inches"],
  ["km/h", "kmh", "kph", "kilometres per hour", "kilometers per hour"],
  ["km/s", "kilometres per second", "kilometers per second"],
  ["mph", "miles per hour"],
  ["°c", "c", "degrees celsius", "celsius", "degrees", "deg"],
  ["°f", "f", "degrees fahrenheit", "fahrenheit"],
  ["%", "percent", "per cent"],
  ["kcal", "cal", "calorie", "calories", "kilocalories"],
  ["people", "persons", "person"],
  ["bpm", "beats per minute"],
  ["kwh", "kilowatt hours", "kilowatt-hours"],
  ["w", "watt", "watts"],
  ["hz", "hertz"],
];

/** Everything that counts as the unit typed after a number, longest first. */
export function unitTokens(unit: string | undefined): string[] {
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return [];
  const first = u.split(/\s+/)[0];
  const out = new Set<string>([u, u.replace(/s$/, ""), first]);
  for (const group of UNIT_GROUPS) if (group.includes(u) || group.includes(first)) group.forEach((t) => out.add(t));
  out.delete("");
  return [...out].sort((a, b) => b.length - a.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export type NumberError = "empty" | "zero" | "negative" | "text";
export type NumberReading = { value: number } | { error: NumberError };

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
 * `unit` is the question's unit: typed after the number it's just the unit ("330 metres", "330m" in metres).
 * Says why when it can't: nothing typed, zero, a negative, or not a number at all.
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
  const tokens = unitTokens(unit);
  // Only a whole word at the end: "2.5mm" in metres is not "2.5m" with its "m" taken off.
  if (tokens.length) s = s.replace(new RegExp(`(?<=[\\d.\\s])(?:${tokens.map(escape).join("|")})\\.?$`), "").trim();
  const m = s.match(/^([+-]?)\s*([\d.,\s]*\d(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|[\d.]+)\s*([a-z]*)\.?$/);
  if (!m) return { error: "text" };
  const [, sign, digits, word] = m;
  const n = readDigits(digits.trim());
  const scale = word ? SCALES[word] : 1;
  if (n === null || scale === undefined) return { error: "text" };
  const value = n * scale;
  if (!Number.isFinite(value)) return { error: "text" };
  if (value === 0) return { error: "zero" };
  if (sign === "-") return { error: "negative" };
  return { value };
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

/** The echo under the field: "2,500,000 · 2.5 million", or just "330" under a thousand (and "3e18" past 1e15). */
export function echoText(n: number): string {
  if (n >= 1e15) return formatWords(n);
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
  lost: "□",
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

/** The saved game, if it can go on with this bank (an unfinished game whose questions are all still there). */
export function resumable(save: FathomSave, bank: readonly FathomQuestion[]): FathomGame | undefined {
  const g = save.game;
  if (!g || phaseOf(g) === "results" || g.guesses.length > g.ids.length) return undefined;
  const ids = new Set(bank.map((q) => q.id));
  return g.ids.length === QUESTIONS_PER_GAME && g.ids.every((id) => ids.has(id)) && g.at <= g.guesses.length ? g : undefined;
}
