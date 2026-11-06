// Checks the Fathom question bank (public/fathom/questions.json): shape, ids, kinds, typical misses, answers,
// sources, wording, and the mix of the bank. The rules are in docs/FATHOM.md ("Writing questions").
//   NODE_NO_WARNINGS=1 npx tsx scripts/fathom/check.ts [file]
// A file other than the bank is a file of candidates for it: checked as they would join the bank, and flagged when an
// answer is too long to type or a subject is already in the bank.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isSizeQuestion, ROUND_UNITS, ROUNDS, type Round } from "../../src/game/fathom";

export const BANK = join(import.meta.dirname, "..", "..", "public", "fathom", "questions.json");

export const KINDS = [
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

/** Allowed typical misses: half of casual players land within this many times of the answer. */
export const TYPICALS = [1.3, 1.5, 2, 3, 5, 10, 30] as const;

/** Nov 5: 40, after the judge dropped questions nobody could reason to (a dull or trick question is worse than none). */
export const MIN_QUESTIONS = 40;
/** Question plus definition, in characters: what fits above a phone keyboard with LOCK IN in view. */
export const MAX_SHOWN = 100;
export const MIN_KINDS = 8;
/** No kind takes more than 9 in 50 (18%) of the bank. */
export const maxPerKind = (total: number) => Math.max(9, Math.floor((total * 9) / 50));
export const MIN_EASY = 12;
export const MAX_DEFINITION = 60;
export const MAX_FACT = 200;
/** At most this many digits before the decimal point: the player types the whole number (no scale keys). */
export const MAX_DIGITS = 6;

/** Scale words a unit may start with, for big counts: "million people", "billion trees". */
export const UNIT_SCALES: Record<string, number> = { million: 1e6, billion: 1e9, trillion: 1e12 };

/** A unit as its scale word and the unit after it: "billion trees" is 1e9 of "trees", "metres" 1 of itself. */
export function splitUnit(unit: string): { scale: number; base: string } {
  const m = unit.match(/^(million|billion|trillion) (\S.*)$/);
  return m ? { scale: UNIT_SCALES[m[1]], base: m[2] } : { scale: 1, base: unit };
}

/** The amount an answer stands for, its unit's scale word counted: 86 billion neurons is 8.6e10. */
export const amountOf = (q: Pick<Question, "answer" | "unit">): number =>
  typeof q.unit === "string" ? q.answer * splitUnit(q.unit).scale : q.answer;

/**
 * Units of measure never appear in the question ("How tall is it in metres?"): the game shows the unit beside the
 * input. A count's unit is the thing counted, so "How many tiles cover...?" may name it once, right after "How many".
 */
export const MEASURES = new Set([
  "millimetres",
  "centimetres",
  "metres",
  "kilometres",
  "square metres",
  "square kilometres",
  "litres",
  "grams",
  "kilograms",
  "tonnes",
  "seconds",
  "minutes",
  "hours",
  "days",
  "months",
  "years",
  "degrees Celsius",
  "metres per second",
  "kilometres per hour",
  "times",
]);

const KEYS = new Set(["id", "kind", "round", "question", "unit", "answer", "definition", "fact", "source", "typical", "easy"]);

/** The earliest year a year question may answer: four digits, as the player types it. */
export const MIN_YEAR = 1000;
/** A year question asks for one plainly. */
const ASKS_YEAR = /^(?:In (?:what|which) year|When)\b/;
/** No more than one in five of the bank asks how tall or how heavy (a warning for now: bankWarnings). */
export const MAX_SIZE_SHARE = 1 / 5;

export type Kind = (typeof KINDS)[number];
export interface Question {
  id: string;
  kind: Kind;
  /** Absent: an estimate. */
  round?: Round;
  question: string;
  unit: string;
  answer: number;
  definition?: string;
  fact: string;
  source: { title: string; url: string };
  /** An estimate's only. */
  typical?: (typeof TYPICALS)[number];
  easy: boolean;
}
export interface Bank {
  version: 1;
  questions: Question[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (w: string) => new RegExp(`(^|[^\\p{L}])${escape(w)}($|[^\\p{L}])`, "iu");

/** The number as it might be written in text: "1306", "1,306", "0.49". */
function spellings(n: number): string[] {
  const plain = String(n);
  const grouped = n.toLocaleString("en-US", { maximumFractionDigits: 10 });
  return [...new Set([plain, grouped])];
}
const mentions = (text: string, n: number) =>
  spellings(n).some((s) => new RegExp(`(^|[^\\d.,])${escape(s)}($|[^\\d]|[.,](?!\\d))`).test(text));

/** Problems with one question, each a message starting with its id. */
export function checkQuestion(q: unknown, i: number): string[] {
  const out: string[] = [];
  if (typeof q !== "object" || q === null || Array.isArray(q)) return [`#${i}: not an object`];
  const o = q as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : `#${i}`;
  const bad = (msg: string) => out.push(`${id}: ${msg}`);
  const text = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");

  for (const k of Object.keys(o)) if (!KEYS.has(k)) bad(`unknown field "${k}"`);
  if (typeof o.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.id)) bad("id must be kebab-case");
  if (!KINDS.includes(o.kind as Kind)) bad(`kind "${String(o.kind)}" is not one of ${KINDS.join(", ")}`);
  if (o.round !== undefined && !ROUNDS.includes(o.round as Round)) bad(`round "${String(o.round)}" is not one of ${ROUNDS.join(", ")}`);
  const round: Round = ROUNDS.includes(o.round as Round) ? (o.round as Round) : "estimate";

  const question = text("question");
  if (!question.trim()) bad("question is missing");
  else {
    if (!question.endsWith("?")) bad("question must end with ?");
    if (question.split("?").length > 2) bad("question must ask one thing (one ?)");
    if (question !== question.trim() || /\s{2}/.test(question)) bad("question has stray spaces");
    // With the phone keyboard up (375x400), longer text pushed LOCK IN off the screen (longest-flight-distance, 109).
    const shown = question.length + text("definition").length;
    if (shown > MAX_SHOWN) bad(`question and definition run ${shown} characters; keep them to ${MAX_SHOWN} so LOCK IN stays above a phone keyboard`);
  }

  const unit = text("unit");
  const { scale, base } = splitUnit(unit);
  if (!unit.trim()) bad("unit is missing");
  else {
    if (unit.replace("Celsius", "celsius") !== unit.toLowerCase()) bad(`unit "${unit}" must be lower case`);
    if (/\d/.test(unit)) bad(`unit "${unit}" has a number in it`);
    // A round's unit is its own: "percent" for a percent, "year" for a year, and neither on an estimate.
    const own = ROUND_UNITS[round];
    if (own && unit !== own) bad(`a ${round} question's unit is "${own}", not "${unit}"`);
    for (const [r, u] of Object.entries(ROUND_UNITS))
      if (round === "estimate" && unit === u) bad(`unit "${u}" belongs to a ${r} question: give it round "${r}"`);
    if (round === "year") {
      // The year is what's asked for: the question says so.
      if (question && !ASKS_YEAR.test(question)) bad(`a year question asks "In what year...?" or "When...?"`);
    } else if (question) {
      // A count names what it counts after "How many" ("How many trees...?" in billion trees), never its scale word.
      const rest = MEASURES.has(base) ? question : question.replace(new RegExp(`^How many ${escape(base)}\\b`, "i"), "");
      if (word(base).test(rest)) bad(`question repeats the unit "${base}" (the game shows it beside the input)`);
    }
  }

  const answer = o.answer;
  if (typeof answer !== "number" || !Number.isFinite(answer) || answer <= 0) bad("answer must be a positive finite number");
  else {
    if (question && mentions(question, answer)) bad("question gives away the answer");
    if (typeof o.definition === "string" && mentions(o.definition, answer)) bad("definition gives away the answer");
    if (answer >= 10 ** MAX_DIGITS)
      bad(`answer ${answer} has more than ${MAX_DIGITS} digits before the decimal point: use a bigger unit (kilometres, million people)`);
    if (scale > 1 && answer < 1) bad(`answer ${answer} is under 1 ${unit}: use the unit without "${unit.split(" ")[0]}"`);
    if (round === "percent" && answer > 100) bad(`a percent's answer is 0 to 100, not ${answer}`);
    const thisYear = new Date().getFullYear();
    if (round === "year" && !(Number.isInteger(answer) && answer >= MIN_YEAR && answer <= thisYear))
      bad(`a year's answer is a whole year of four digits (${MIN_YEAR} to ${thisYear}), not ${answer}`);
  }

  if ("definition" in o) {
    const d = o.definition;
    if (typeof d !== "string" || !d.trim()) bad("definition, when present, must be a short phrase");
    else {
      if (d.length > MAX_DEFINITION) bad(`definition is longer than ${MAX_DEFINITION} characters`);
      if (/[.?!]$/.test(d)) bad("definition is a phrase, not a sentence (no end punctuation)");
    }
  }

  const fact = text("fact");
  if (!fact.trim()) bad("fact is missing");
  else {
    if (!fact.endsWith(".")) bad("fact must end with a full stop");
    if (/[.!?]\s+[A-Z]/.test(fact)) bad("fact must be one sentence");
    if (fact.length > MAX_FACT) bad(`fact is longer than ${MAX_FACT} characters`);
  }

  for (const k of ["question", "definition", "fact"]) {
    if (text(k).includes("—")) bad(`${k} has an em dash (UI copy uses none)`);
    if (/\p{Extended_Pictographic}/u.test(text(k))) bad(`${k} has an emoji`);
  }

  const s = o.source as Record<string, unknown> | undefined;
  if (typeof s !== "object" || s === null) bad("source is missing");
  else {
    if (typeof s.title !== "string" || !s.title.trim()) bad("source.title is missing");
    let url: URL | undefined;
    try {
      url = new URL(String(s.url));
    } catch {
      bad(`source.url "${String(s.url)}" is not a URL`);
    }
    if (url && url.protocol !== "https:") bad(`source.url must be https`);
    for (const k of Object.keys(s)) if (k !== "title" && k !== "url") bad(`unknown source field "${k}"`);
  }

  // The typical miss is a ratio: it means something on an estimate only.
  if (round !== "estimate") {
    if ("typical" in o) bad(`typical is an estimate's (a ratio): leave it out of a ${round} question`);
  } else if (!TYPICALS.includes(o.typical as (typeof TYPICALS)[number])) bad(`typical ${String(o.typical)} is not one of ${TYPICALS.join(", ")}`);
  if (typeof o.easy !== "boolean") bad("easy must be true or false");
  return out;
}

/** Every problem with the bank; empty when it is fine to ship. */
export function checkBank(bank: unknown): string[] {
  if (typeof bank !== "object" || bank === null) return ["bank is not an object"];
  const b = bank as Record<string, unknown>;
  const out: string[] = [];
  for (const k of Object.keys(b)) if (k !== "version" && k !== "questions") out.push(`unknown top-level field "${k}"`);
  if (b.version !== 1) out.push(`version must be 1, not ${String(b.version)}`);
  if (!Array.isArray(b.questions)) return [...out, "questions must be an array"];
  const qs = b.questions as unknown[];
  qs.forEach((q, i) => out.push(...checkQuestion(q, i)));
  const valid = qs.filter((q): q is Question => typeof q === "object" && q !== null) as Question[];

  const seen = new Set<string>();
  for (const q of valid) {
    if (seen.has(q.id)) out.push(`${q.id}: duplicate id`);
    seen.add(q.id);
  }
  const asked = new Map<string, string>();
  for (const q of valid) {
    const key = String(q.question).toLowerCase();
    if (asked.has(key)) out.push(`${q.id}: same question as ${asked.get(key)}`);
    asked.set(key, q.id);
  }

  // A fact is read after its own question, but never gives away another one's answer (3+ digit answers: small
  // numbers turn up everywhere by chance). A year question's answer is given away by any other question's text that
  // states it, its question and definition too ("Woodstock in 1969" beside "In what year...").
  const isYear = (q: Question) => q.round === "year";
  for (const q of valid) {
    for (const other of valid) {
      if (other === q || isYear(other) || typeof other.answer !== "number" || other.answer < 100 || typeof q.fact !== "string") continue;
      if (mentions(q.fact, other.answer)) out.push(`${q.id}: fact gives away the answer to ${other.id} (${other.answer})`);
    }
  }
  for (const q of valid) {
    for (const other of valid.filter(isYear)) {
      if (other === q || typeof other.answer !== "number") continue;
      for (const field of ["definition", "fact", "question"] as const) {
        const text = q[field];
        if (typeof text === "string" && mentions(text, other.answer)) out.push(`${q.id}: ${field} gives away the answer to ${other.id} (${other.answer})`);
      }
    }
  }

  if (qs.length < MIN_QUESTIONS) out.push(`${qs.length} questions; the bank needs at least ${MIN_QUESTIONS}`);
  const counts = kindCounts(valid);
  if (counts.size < MIN_KINDS) out.push(`${counts.size} kinds; the bank needs at least ${MIN_KINDS}`);
  const cap = maxPerKind(qs.length);
  for (const [kind, n] of counts) if (n > cap) out.push(`${n} questions of kind ${kind}; at most ${cap}`);
  const easy = valid.filter((q) => q.easy === true).length;
  if (easy < MIN_EASY) out.push(`${easy} easy openers; the bank needs at least ${MIN_EASY}`);
  // Magnitudes by the amount, its unit's scale word counted (86 billion neurons is in the billions): estimates only, as
  // a percent or a year is no magnitude.
  const answers = valid.filter((q) => typeof q.answer === "number" && (q.round ?? "estimate") === "estimate").map(amountOf);
  if (!answers.some((a) => a < 1)) out.push("no answer under 1: the bank needs a spread of magnitudes");
  if (!answers.some((a) => a >= 1e9)) out.push("no answer in the billions: the bank needs a spread of magnitudes");
  return out;
}

/** The how tall / how heavy questions in a bank (isSizeQuestion, src/game/fathom.ts). */
export function sizeQuestions(bank: unknown): Question[] {
  const qs = ((bank as Bank | null)?.questions ?? []) as unknown[];
  const readable = (q: unknown): q is Question =>
    typeof q === "object" && q !== null && typeof (q as Question).question === "string" && typeof (q as Question).unit === "string";
  return qs.filter(readable).filter((q) => isSizeQuestion(q));
}

/**
 * What the bank should fix but may ship with for now: more than one in five of it asking how tall or how heavy (the
 * owner: "Too many are how much does xx weigh, how tall is xx"). A warning until the rebuilt bank lands, then an error.
 */
export function bankWarnings(bank: unknown): string[] {
  const total = ((bank as Bank | null)?.questions ?? []).length;
  const n = sizeQuestions(bank).length;
  const cap = Math.floor(total * MAX_SIZE_SHARE);
  if (!total || n <= cap) return [];
  return [`${n} of ${total} questions (${Math.round((n / total) * 100)}%) are how tall / how heavy; at most 1 in 5 (${cap})`];
}

/**
 * Words that say how something is asked or measured ("How tall is the..."), not what it is about: left out when two
 * questions' subjects are compared.
 */
const NOT_SUBJECT = new Set(
  (
    "a an the of in on at to for from by with and or as its it is are was were be been does do did has have had " +
    "how what which who many much long tall high deep wide far fast big large heavy hot cold old weigh weighs " +
    "take takes last lasts hold holds can could would there each every one once all ever most known world worlds " +
    "typical average standard modern adult person people record largest biggest longest tallest fastest deepest " +
    "heaviest highest oldest smallest human live lives"
  ).split(" "),
);

/** What a question is about: its content words, lower case, without a possessive or a plural s. */
export function subjectWords(question: string): Set<string> {
  const words = question
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !NOT_SUBJECT.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return new Set(words);
}

/** The page a source points at, comparable across spellings ("Eiffel_Tower", "Eiffel%20Tower"). */
function sourcePage(url: unknown): string {
  try {
    const u = new URL(String(url));
    return (u.host + decodeURIComponent(u.pathname)).toLowerCase().replace(/[_\s]+/g, " ");
  } catch {
    return "";
  }
}

/**
 * Whether two questions are about the same thing: the same source page ("How tall is a giraffe?" and "How long is a
 * giraffe's tongue?" both come from "Giraffe"), or mostly the same subject words (half of all of them, or more).
 */
export function sameSubject(a: Pick<Question, "question" | "source">, b: Pick<Question, "question" | "source">): boolean {
  const page = sourcePage(a.source?.url);
  if (page && page === sourcePage(b.source?.url)) return true;
  const x = subjectWords(String(a.question));
  const y = subjectWords(String(b.question));
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared > 0 && shared / (x.size + y.size - shared) >= 0.5;
}

/** The owner's rule for units: at most 6 digits before the decimal point ("million people", not "people"). */
export const MAX_ANSWER = 1e6;

/**
 * Problems with a file of candidate questions for the bank: each candidate's own checks, the bank they would make
 * together (ids, repeated questions, facts that give away an answer, the mix), answers too long to type, and any
 * candidate about the same subject as a question already in the bank or another candidate.
 */
export function checkCandidates(candidates: unknown, bank: unknown): string[] {
  if (typeof candidates !== "object" || candidates === null) return ["candidates file is not an object"];
  const c = candidates as Record<string, unknown>;
  if (!Array.isArray(c.questions)) return ["questions must be an array"];
  const banked = (((bank as Bank | null)?.questions ?? []) as Question[]).filter((q) => typeof q === "object" && q);
  const fresh = (c.questions as unknown[]).filter((q): q is Question => typeof q === "object" && q !== null);

  const out = checkBank({ ...c, questions: [...banked, ...(c.questions as unknown[])] });
  for (const q of fresh) {
    if (typeof q.answer === "number" && q.answer >= MAX_ANSWER)
      out.push(`${q.id}: answer has more than 6 digits before the decimal point; scale the unit ("million people")`);
    for (const b of banked)
      if (sameSubject(q, b)) out.push(`${q.id}: same subject as ${b.id} in the bank ("${b.question}")`);
  }
  fresh.forEach((q, i) => {
    for (const other of fresh.slice(i + 1))
      if (sameSubject(q, other)) out.push(`${other.id}: same subject as candidate ${q.id} ("${q.question}")`);
  });
  return out;
}

export function kindCounts(questions: Pick<Question, "kind">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const q of questions) counts.set(q.kind, (counts.get(q.kind) ?? 0) + 1);
  return counts;
}

export function loadBank(file = BANK): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function main(): number {
  const file = resolve(process.argv[2] ?? BANK);
  const bank = loadBank(file);
  // Any file but the bank holds candidates for it ("scripts/fathom/candidates-2.json"), checked against the bank.
  const issues = file === resolve(BANK) ? checkBank(bank) : checkCandidates(bank, loadBank());
  const qs = (bank as Bank).questions ?? [];
  const counts = [...kindCounts(qs)].sort((a, b) => b[1] - a[1]);
  console.log(`${qs.length} questions, ${qs.filter((q) => q.easy).length} easy`);
  console.log(counts.map(([k, n]) => `${k} ${n}`).join(", "));
  console.log(ROUNDS.map((r) => `${r} ${qs.filter((q) => (q.round ?? "estimate") === r).length}`).join(", "));
  const sizes = sizeQuestions(bank).length;
  console.log(`how tall / how heavy: ${sizes} of ${qs.length} (${qs.length ? Math.round((sizes / qs.length) * 100) : 0}%)`);
  for (const w of bankWarnings(bank)) console.log(`  warning: ${w}`);
  for (const i of issues) console.log(`  error: ${i}`);
  console.log(`${issues.length} error(s)`);
  return issues.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
