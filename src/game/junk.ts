import { normalize } from "./match";

/**
 * Letter-trigram model of what real answers look like, trained on an English word list
 * plus every answer and alias in the puzzle bank. Used to tell a real (wrong) guess from
 * keyboard mash, so mash doesn't cost a life.
 */
export interface Lexicon {
  alphabet: string;
  /** Quantized -log2 P(c | a, b) for every trigram, one char each: code - 33 = quarter-bits. */
  table: string;
  /** FNV-1a hashes (base 36) of every normalized name in the bank, always treated as real. */
  names: string;
}

export const ALPHABET = "^$ 0abcdefghijklmnopqrstuvwxyz";
const N = ALPHABET.length;

function symbols(s: string): number[] {
  const t = normalize(s).replace(/[0-9]/g, "0").replace(/[^a-z0 ]/g, "");
  return ["^", "^", ...t, "$"].map((c) => ALPHABET.indexOf(c));
}

export function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Interpolated trigram model. Words get weight 1, puzzle names `nameWeight`. */
export function trainLexicon(words: string[], names: string[], nameWeight = 5): Lexicon {
  const c3 = new Float64Array(N ** 3);
  const c2 = new Float64Array(N ** 2);
  const c1 = new Float64Array(N);
  const add = (s: string, w: number) => {
    const y = symbols(s);
    for (let i = 2; i < y.length; i++) {
      c3[(y[i - 2] * N + y[i - 1]) * N + y[i]] += w;
      c2[y[i - 1] * N + y[i]] += w;
      c1[y[i]] += w;
    }
  };
  for (const w of words) add(w, 1);
  const uniqueNames = new Set(names.map(normalize).filter(Boolean));
  for (const s of uniqueNames) add(s, nameWeight);

  const total1 = c1.reduce((a, b) => a + b, 0);
  const ctx2 = new Float64Array(N);
  const ctx3 = new Float64Array(N * N);
  for (let a = 0; a < N; a++)
    for (let b = 0; b < N; b++) {
      ctx2[a] += c2[a * N + b];
      for (let c = 0; c < N; c++) ctx3[a * N + b] += c3[(a * N + b) * N + c];
    }

  let table = "";
  for (let a = 0; a < N; a++)
    for (let b = 0; b < N; b++)
      for (let c = 0; c < N; c++) {
        const p1 = (c1[c] + 1) / (total1 + N);
        const p2 = (c2[b * N + c] + 2 * p1) / (ctx2[b] + 2);
        const p3 = (c3[(a * N + b) * N + c] + 2 * p2) / (ctx3[a * N + b] + 2);
        table += String.fromCharCode(33 + Math.min(90, Math.round(-Math.log2(p3) * 4)));
      }

  const names36 = [...uniqueNames].map((s) => fnv(s).toString(36)).join(" ");
  return { alphabet: ALPHABET, table, names: names36 };
}

/** Mean log2 probability per letter. Real names mostly sit between -2.5 and -6; mash below -7. */
export function plausibility(text: string, lex: Lexicon): number {
  const y = symbols(text);
  let sum = 0;
  for (let i = 2; i < y.length; i++) {
    sum -= (lex.table.charCodeAt((y[i - 2] * N + y[i - 1]) * N + y[i]) - 33) / 4;
  }
  return sum / (y.length - 2);
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];
const KEY_COLUMNS = ["qaz", "wsx", "edc", "rfv", "tgb", "yhn", "ujm"];

function keyStep(a: string, b: string): number {
  for (const row of KEY_ROWS) {
    const i = row.indexOf(a);
    const j = row.indexOf(b);
    if (i >= 0 && j >= 0) return j - i;
  }
  return 0;
}

/**
 * "asdf", "lkjh", "qwerty", or a whole short string of neighbouring keys like "jkl" / "tgb".
 * The run must keep one direction, so back-and-forth like "popo" in Popocatepetl doesn't count.
 */
function isKeyboardRun(letters: string): boolean {
  if (KEY_COLUMNS.some((c) => letters === c || letters === [...c].reverse().join(""))) return true;
  let run = 1;
  let best = 1;
  let dir = 0;
  for (let i = 1; i < letters.length; i++) {
    const step = keyStep(letters[i - 1], letters[i]);
    if (Math.abs(step) === 1 && (run === 1 || step === dir)) run++;
    else run = Math.abs(step) === 1 ? 2 : 1;
    dir = step;
    best = Math.max(best, run);
  }
  return best >= 4 || (letters.length >= 3 && best === letters.length);
}

const NON_ANSWERS = new Set(
  "lol lmao idk dunno pass skip test blah hmm hm um uh ok okay yes no nope hi hello help none nothing something anything no idea i dont know".split(
    " ",
  ),
);
NON_ANSWERS.add("no idea");
NON_ANSWERS.add("i dont know");

export const JUNK_THRESHOLD = -6.8;

let nameSetCache: { src: string; set: Set<string> } | null = null;
function knownNames(lex: Lexicon): Set<string> {
  if (nameSetCache?.src !== lex.names) nameSetCache = { src: lex.names, set: new Set(lex.names.split(" ")) };
  return nameSetCache.set;
}

/** Whether the text is exactly some answer or alias in the bank, or a country or capital. */
export function isKnownName(text: string, lex: Lexicon): boolean {
  return knownNames(lex).has(fnv(normalize(text)).toString(36));
}

export function isJunk(text: string, lex?: Lexicon): boolean {
  const s = normalize(text);
  const letters = s.replace(/[^a-z0-9]/g, "");
  if (letters.length < 2 || NON_ANSWERS.has(s)) return true;
  if (lex && isKnownName(text, lex)) return false;
  if (/(.)\1\1/.test(letters)) return true;
  // "jfjfj", "sdfsdfsdf". Two repeats are left to the model: Nkunku, Coco and Bora Bora are real.
  if (/^(.{1,3})\1\1+/.test(letters)) return true;
  if (isKeyboardRun(letters)) return true;
  // Short all-consonant strings may be acronyms (BTS, KFC); longer ones aren't words.
  if (letters.length > 4 && !/[aeiouy0-9]/.test(letters)) return true;
  if (letters.length <= 3) return false;
  return lex ? plausibility(s, lex) < JUNK_THRESHOLD : false;
}
