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
  /**
   * FNV-1a hashes (base 36) of ordinary English words that appear as a word inside some answer's name but don't name
   * an answer players mean by it ("humans", "water", "trees"; scripts/lexicon.ts decides). Typed alone they are a
   * word, not part of a name: the matcher doesn't read them as one ("humans" is not Destroy All Humans!), though an
   * entry named exactly that still matches. Optional: older lexicons don't have it.
   */
  words?: string;
  /**
   * FNV-1a hashes of "misspelling>name" pairs: aliases the bank stores within two edits of their own entry's name
   * ("Afganistan" on Afghanistan, "Missisippi" on Mississippi). Such a text is a known name, yet on a list where it
   * isn't an alias it is still a slip of that entry, not a different real name (`isSlipOf`). Optional.
   */
  slips?: string;
  /**
   * FNV-1a hashes of the words of people's names on the bank's people lists ("alcaraz", "jeremy", "johnston"). Typed
   * alone, such a word is someone's name: it is corrected only by one slip, and on a list of names not at all. Optional.
   */
  people?: string;
  /** "form:country" pairs of FNV-1a hashes: a country's usual forms ("nippon", "uk") to its name. Optional. */
  countries?: string;
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
 * "asdf", "lkjh", "qwerty", or a whole short string of neighbouring keys like "jkl" / "tgb", one word at a time.
 * The run must keep one direction, so back-and-forth like "popo" in Popocatepetl doesn't count, and it must be most
 * of its word: "erty" in "Liberty" and "ytre" in "Skytree" are ordinary spelling (the audit, Nov 8).
 */
function isKeyboardRun(word: string): boolean {
  if (KEY_COLUMNS.some((c) => word === c || word === [...c].reverse().join(""))) return true;
  let run = 1;
  let best = 1;
  let dir = 0;
  for (let i = 1; i < word.length; i++) {
    const step = keyStep(word[i - 1], word[i]);
    if (Math.abs(step) === 1 && (run === 1 || step === dir)) run++;
    else run = Math.abs(step) === 1 ? 2 : 1;
    dir = step;
    best = Math.max(best, run);
  }
  return best >= 5 || (best >= 4 && best >= word.length - 1) || (word.length >= 3 && best === word.length);
}

/**
 * Whether a short run of letters is keyboard mash rather than a code: nearly all of it from one row of keys ("sjdhf",
 * "bnmv", "pqpq"). Codes and acronyms spread over the keyboard: TMNT, CSGO, BNHA, FMAB, ASML, MKBHD.
 */
function oneRow(letters: string): boolean {
  const rows = KEY_ROWS.slice(0, 3).map((row) => [...letters].filter((c) => row.includes(c)).length);
  return Math.max(...rows) >= 0.8 * letters.length;
}

const NON_ANSWERS = new Set("lol lmao test blah hmm hm um uh ok okay yes hi hello help something anything".split(" "));

/**
 * What a player types to give up on a guess ("pass", "idk", "no idea"). Never an answer (`isGiveUp`): no life lost, a
 * plain line. "pass" was read as "Pats" (the Patriots), "dunno" as Warrick Dunn, "no idea" as Nvidia (the audit).
 */
const GIVE_UP = [
  ..."pass skip next dunno duno dno idk idek idc nope no none nothing unsure".split(" "),
  "no idea", "i have no idea", "no clue", "not sure", "dont know", "i dont know", "i do not know", "give up",
  "i give up", "giveup", "beats me", "who knows", "pass please", "skip this", "next one",
];
/** Normalized on first use ("i" reads as the numeral 1); normalize() isn't ready while this module loads. */
let giveUpSet: Set<string> | null = null;

/** Whether the text is a way of saying "I don't know" (or a bare question mark). */
export function isGiveUp(text: string): boolean {
  giveUpSet ??= new Set(GIVE_UP.map(normalize));
  const s = normalize(text);
  return giveUpSet.has(s) || (!s && /\?/.test(text));
}

export const JUNK_THRESHOLD = -6.8;

let nameSetCache: { src: string; set: Set<string> } | null = null;
function knownNames(lex: Lexicon): Set<string> {
  if (nameSetCache?.src !== lex.names) nameSetCache = { src: lex.names, set: new Set(lex.names.split(" ")) };
  return nameSetCache.set;
}

let wordSetCache: { src: string; set: Set<string> } | null = null;

/**
 * Whether the text is an ordinary English word that names no answer a player means by it (see `Lexicon.words`). The
 * lexicon decides which names count: an obscure pool entry called "Humans" or "Music" doesn't stop the word being
 * plain. Such an entry still matches when typed in full, since only readings of it as part of a longer name stop.
 */
export function isPlainWord(text: string, lex?: Lexicon): boolean {
  if (!lex?.words) return false;
  if (wordSetCache?.src !== lex.words) wordSetCache = { src: lex.words, set: new Set(lex.words.split(" ")) };
  const s = normalize(text);
  return !s.includes(" ") && wordSetCache.set.has(fnv(s).toString(36));
}

/** Whether the text is exactly some answer or alias in the bank, or a country or capital. */
export function isKnownName(text: string, lex: Lexicon): boolean {
  return knownNames(lex).has(fnv(normalize(text)).toString(36));
}

const setCaches = new Map<string, { src: string; set: Set<string> }>();
function hashSet(field: "slips" | "people", lex: Lexicon): Set<string> {
  const src = lex[field] ?? "";
  let c = setCaches.get(field);
  if (c?.src !== src) setCaches.set(field, (c = { src, set: new Set(src.split(" ").filter(Boolean)) }));
  return c.set;
}

/** Whether the bank stores the text as a misspelling alias of an entry with this name (`Lexicon.slips`). */
export function isSlipOf(text: string, name: string, lex?: Lexicon): boolean {
  return !!lex?.slips && hashSet("slips", lex).has(fnv(`${normalize(text)}>${normalize(name)}`).toString(36));
}

/** Whether the text is one word of a person's name in the bank, like "alcaraz" or "jeremy" (`Lexicon.people`). */
export function isPersonWord(text: string, lex?: Lexicon): boolean {
  const s = normalize(text);
  return !!lex?.people && !s.includes(" ") && hashSet("people", lex).has(fnv(s).toString(36));
}

let countryCache: { src: string; map: Map<string, string> } | null = null;
/** The hash of the country a text names by one of its usual forms ("nippon": Japan), or of the text itself. */
export function countryKey(text: string, lex?: Lexicon): string {
  const h = fnv(normalize(text)).toString(36);
  const src = lex?.countries ?? "";
  if (countryCache?.src !== src) countryCache = { src, map: new Map(src.split(" ").filter(Boolean).map((p) => p.split(":") as [string, string])) };
  return countryCache.map.get(h) ?? h;
}

/** A web address: "bbc.co.uk", "x.com". */
const DOMAIN = /^\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}\/?\s*$/i;

/**
 * Whether the text doesn't look like an answer: keyboard mash ("asdf", "sjdhf"), a run of one letter, chat filler
 * ("lol", "ok"). Known names never are ("hello" is Adele's, "help" the Beatles'), and neither are numbers ("4",
 * "1989"), letter-digit codes (RAV4, 4chan, 6ix9ine), web addresses or short acronyms spread over the keyboard (TMNT,
 * CSGO, MKBHD): the audit found all of those called junk (Nov 8).
 */
export function isJunk(text: string, lex?: Lexicon): boolean {
  const s = normalize(text);
  const letters = s.replace(/[^a-z0-9]/g, "");
  if (/^\d{1,4}$/.test(letters)) return false;
  if (letters.length < 2) return true;
  if (lex && isKnownName(text, lex)) return false;
  if (NON_ANSWERS.has(s) || isGiveUp(text)) return true;
  if (DOMAIN.test(text)) return false;
  const words = s.split(" ").map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  // Three of a letter in a row, within a word: across a break it is a real name ("Merrill Lynch", "Bell Labs").
  if (words.some((w) => /(.)\1\1/.test(w))) return true;
  // "jfjfj", "sdfsdfsdf". Two repeats are left to the model: Nkunku, Coco and Bora Bora are real.
  if (/^(.{1,3})\1\1+/.test(letters)) return true;
  if (words.some((w) => isKeyboardRun(w))) return true;
  // Letters and digits together are a code or a handle: RAV4, 4chan, 9gag, 6ix9ine, PS5.
  if (/[a-z]/.test(letters) && /\d/.test(letters)) return false;
  // Long all-consonant strings aren't words; short ones may be acronyms (BTS, KFC, MKBHD).
  if (letters.length > 5 && !/[aeiouy0-9]/.test(letters)) return true;
  if (letters.length <= 3 || !lex) return false;
  const reads = (w: string) => plausibility(w, lex) >= JUNK_THRESHOLD;
  // Four or five letters the letter model can't place are a code unless they sit on one row of keys: the model can't
  // tell TMNT or CSGO from mash, while mash comes off one row ("sjdhf", "bnmv"). Words on one row ("tower") read.
  const short = (w: string) => w.length <= 5 && (!oneRow(w) || reads(w));
  if (letters.length <= 5 && words.length === 1) return !short(letters);
  if (reads(s)) return false;
  // Several words, each of which reads on its own ("tj maxx": a short code and a short word), aren't mash.
  return words.length < 2 || !words.every((w) => short(w) || reads(w));
}
