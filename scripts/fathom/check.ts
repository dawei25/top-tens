// Checks the Fathom question bank (public/fathom/questions.json): shape, ids, kinds, typical misses, answers,
// sources, wording, and the mix of the bank. The rules are in docs/FATHOM.md ("Writing questions").
//   NODE_NO_WARNINGS=1 npx tsx scripts/fathom/check.ts [file]
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const KEYS = new Set(["id", "kind", "question", "unit", "answer", "definition", "fact", "source", "typical", "easy"]);

export type Kind = (typeof KINDS)[number];
export interface Question {
  id: string;
  kind: Kind;
  question: string;
  unit: string;
  answer: number;
  definition?: string;
  fact: string;
  source: { title: string; url: string };
  typical: (typeof TYPICALS)[number];
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

  const question = text("question");
  if (!question.trim()) bad("question is missing");
  else {
    if (!question.endsWith("?")) bad("question must end with ?");
    if (question.split("?").length > 2) bad("question must ask one thing (one ?)");
    if (question !== question.trim() || /\s{2}/.test(question)) bad("question has stray spaces");
  }

  const unit = text("unit");
  const { scale, base } = splitUnit(unit);
  if (!unit.trim()) bad("unit is missing");
  else {
    if (unit.replace("Celsius", "celsius") !== unit.toLowerCase()) bad(`unit "${unit}" must be lower case`);
    if (/\d/.test(unit)) bad(`unit "${unit}" has a number in it`);
    if (question) {
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

  if (!TYPICALS.includes(o.typical as (typeof TYPICALS)[number]))
    bad(`typical ${String(o.typical)} is not one of ${TYPICALS.join(", ")}`);
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
  // numbers turn up everywhere by chance).
  for (const q of valid) {
    for (const other of valid) {
      if (other === q || typeof other.answer !== "number" || other.answer < 100 || typeof q.fact !== "string") continue;
      if (mentions(q.fact, other.answer)) out.push(`${q.id}: fact gives away the answer to ${other.id} (${other.answer})`);
    }
  }

  if (qs.length < MIN_QUESTIONS) out.push(`${qs.length} questions; the bank needs at least ${MIN_QUESTIONS}`);
  const counts = kindCounts(valid);
  if (counts.size < MIN_KINDS) out.push(`${counts.size} kinds; the bank needs at least ${MIN_KINDS}`);
  const cap = maxPerKind(qs.length);
  for (const [kind, n] of counts) if (n > cap) out.push(`${n} questions of kind ${kind}; at most ${cap}`);
  const easy = valid.filter((q) => q.easy === true).length;
  if (easy < MIN_EASY) out.push(`${easy} easy openers; the bank needs at least ${MIN_EASY}`);
  // Magnitudes by the amount, its unit's scale word counted (86 billion neurons is in the billions).
  const answers = valid.filter((q) => typeof q.answer === "number").map(amountOf);
  if (!answers.some((a) => a < 1)) out.push("no answer under 1: the bank needs a spread of magnitudes");
  if (!answers.some((a) => a >= 1e9)) out.push("no answer in the billions: the bank needs a spread of magnitudes");
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
  const file = process.argv[2] ?? BANK;
  const bank = loadBank(file);
  const issues = checkBank(bank);
  const qs = (bank as Bank).questions ?? [];
  const counts = [...kindCounts(qs)].sort((a, b) => b[1] - a[1]);
  console.log(`${qs.length} questions, ${qs.filter((q) => q.easy).length} easy`);
  console.log(counts.map(([k, n]) => `${k} ${n}`).join(", "));
  for (const i of issues) console.log(`  error: ${i}`);
  console.log(`${issues.length} error(s)`);
  return issues.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
