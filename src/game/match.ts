import { countryKey, isGiveUp, isJunk, isKnownName, isPersonWord, isPlainWord, isSlipOf, type Lexicon } from "./junk";
import type { Entry, GuessResult, Puzzle } from "./types";

/**
 * A guess that is no answer here, as judgeGuess reads it: GuessResult's "unknown", saying a little more. `known`: what
 * was typed is a real name the bank knows (an answer on another list, a country, someone's name), so the game says
 * so ("Point72 isn't in this ranking.") rather than "Not one of the 151 firms here.". `giveUp`: a way of saying "I
 * don't know" ("pass", "idk"), which is never an answer.
 */
export type UnknownVerdict = Extract<GuessResult, { kind: "unknown" }> & { known?: true; giveUp?: true };
export type Verdict = Exclude<GuessResult, { kind: "unknown" }> | UnknownVerdict;

const LEADING_ARTICLE = /^(the|a|an)\s+/;

const ROMAN: Record<string, string> = Object.fromEntries(
  "i ii iii iv v vi vii viii ix x xi xii xiii xiv xv xvi xvii xviii xix xx".split(" ").map((r, i) => [r, String(i + 1)]),
);

/** Lowercase, no accents or punctuation, no leading article, Roman numerals as digits ("GTA V" → "gta 5"). */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(LEADING_ARTICLE, "")
    .split(" ")
    .map((t) => ROMAN[t] ?? t)
    .join(" ");
}

const CODE = /^[A-Z0-9]{2,4}$/;

const NUMBER_WORDS: Record<string, string> = Object.fromEntries(
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
    .split(" ")
    .map((w, i) => [w, String(i + 1)]),
);

/** Number words as digits, so "frozen two" meets "Frozen II" (normalized "frozen 2"). */
/** Ordinals count as their digits too: "squid game second season" is Season 2. */
const ORDINALS: Record<string, string> = Object.fromEntries([
  ..."first second third fourth fifth sixth seventh eighth ninth tenth".split(" ").map((w, i) => [w, String(i + 1)]),
  ..."1st 2nd 3rd 4th 5th 6th 7th 8th 9th 10th".split(" ").map((w, i) => [w, String(i + 1)]),
]);

function numbersAsDigits(s: string): string {
  return s
    .split(" ")
    .map((w) => NUMBER_WORDS[w] ?? ORDINALS[w] ?? w)
    .join(" ");
}

function digitsOf(s: string): string {
  return (s.match(/\d+/g) ?? []).join(" ");
}

/** Whether `part`'s words appear, in order and whole, inside `whole` ("neptune" in "neptune 1"). */
function wordsWithin(part: string, whole: string): boolean {
  return part.length > 0 && ` ${whole} `.includes(` ${part} `);
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Drop the whole words two names share at the start and the end ("mount everst" / "mount everest" → "everst" / "everest"). */
export function withoutSharedWords(a: string, b: string): [string, string] {
  const x = a.split(" ");
  const y = b.split(" ");
  while (x.length > 1 && y.length > 1 && x[0] === y[0]) {
    x.shift();
    y.shift();
  }
  while (x.length > 1 && y.length > 1 && x[x.length - 1] === y[y.length - 1]) {
    x.pop();
    y.pop();
  }
  return [x.join(" "), y.join(" ")];
}

/** Edits we silently accept as the same word. */
export function autoCorrectBudget(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 10) return 2;
  return 3;
}

/**
 * Edits within which a guess is treated as a misspelling and corrected in the input. Short words get no extra
 * slack: two changed letters out of four ("wilt" / "west") is a different word, not a typo. Six or seven letters
 * get two: three changes there turn one ordinary word into another ("planes" / "Poland", "church" / "Charli"),
 * while real slips ("Hungery", "Marocco", "Phoneix") are one or two.
 */
export function typoBudget(len: number): number {
  if (len <= 5) return autoCorrectBudget(len);
  if (len <= 7) return 2;
  return autoCorrectBudget(len) + 1;
}

interface Candidate {
  entry: Entry;
  inTop10: boolean;
  dist: number;
  len: number;
  /** The guess is exactly this entry's full name, not just an alias or a word of it. */
  fullName: boolean;
  /** The best match was only one word of the name ("Britain" in "New Britain"), not a name or alias. */
  viaWord: boolean;
  /** The best form starts and ends with the same letters as the guess: a slip in the middle ("Hungray"). */
  ends: boolean;
  /** Whole words were shared with the best form and the rest starts with the same letter: "john rahm" / "jon rahm". */
  besideShared: boolean;
  /** The best form starts with the same letter as the guess. */
  sameStart: boolean;
  /** The best form sounds like the guess: the same consonants (`skeleton`), "hungary" / "hungray". */
  sounds: boolean;
}

interface Forms {
  /** The name, then the aliases, then the forms `formsOf` derives from them, normalized. */
  forms: string[];
  /** Distinctive words of the name (`nameWords`). */
  words: string[];
  /** Which forms are codes (ATL, EDDF, PRC), as written. */
  codes: boolean[];
}
const formsCache = new WeakMap<Entry, Forms>();

/**
 * An entry's forms, normalized once. Besides the name and aliases: each part of a slash-joined name ("The Fame / The
 * Fame Monster": "The Fame", "The Fame Monster"), and "&" between single letters as players type it ("Texas A&M":
 * "texas am", "H&M": "hm").
 */
function formsOf(entry: Entry): Forms {
  let f = formsCache.get(entry);
  if (f) return f;
  const written = [entry.name, ...entry.aliases];
  // A spaced slash only: "Mega Drive/Genesis Mini" is the Mini of both names, not "Mega Drive" and "Genesis Mini".
  const parts = entry.name.split(/\s+\/\s+/);
  const slashed = parts.length > 1 && parts.every((p) => p.replace(/[^\p{L}]/gu, "").length >= 3) ? parts : [];
  const raw = [...written, ...slashed];
  const forms = raw.map(normalize);
  const codes = raw.map((r) => CODE.test(r));
  for (const s of [...forms]) {
    const joined = s.replace(/(^| )([a-z0-9]) and ([a-z0-9])(?= |$)/g, "$1$2$3");
    if (joined !== s) {
      forms.push(joined);
      codes.push(false);
    }
  }
  f = { forms, words: nameWords(entry.name), codes };
  formsCache.set(entry, f);
  return f;
}

/** Letters that sound alike at the start of a word: "kanada" is Canada, "jiraffe" a giraffe. */
const SOUNDS_ALIKE = ["ckqs", "gj", "iye", "sz", "vw"];
const soundAlike = (a: string, b: string) => a === b || SOUNDS_ALIKE.some((s) => s.includes(a) && s.includes(b));

/**
 * A word as it sounds, roughly: consonants only, with c/k/q as k (s before e, i, y), z as s, ph as f, sh and th as s
 * and t, an h after a consonant dropped, doubles once ("cincinatti": knknt, "patrisha" and "patricia": ptrs).
 */
function skeleton(s: string): string {
  return s
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f")
    .replace(/sh/g, "s")
    .replace(/th/g, "t")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/([^aeiouy])h/g, "$1")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/[aeiouy]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function isSubsequence(a: string, b: string): boolean {
  let i = 0;
  for (const c of b) if (c === a[i]) i++;
  return i === a.length;
}

/**
 * Whether turning `a` into `b` swaps a whole run of letters for different ones beside a long shared part, rather than
 * slipping: "snapchat" / "Stripchat" ("sna" / "stri" before "pchat"), "snap chat" / "ShareChat" ("snap" / "share"). A
 * real misspelling keeps the run's letters (some dropped: "missisipi"), or its sound ("Packeestan", "cincinatti").
 */
function swapsWord(a: string, b: string): boolean {
  const x = a.replace(/ /g, "");
  const y = b.replace(/ /g, "");
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  if (Math.max(p, s) < 4) return false;
  const xm = x.slice(p, x.length - s);
  const ym = y.slice(p, y.length - s);
  // A single letter is a slip, however it's replaced ("arnaud" / "Arnault").
  if (Math.min(xm.length, ym.length) < 2 || isSubsequence(xm, ym) || isSubsequence(ym, xm)) return false;
  const d = editDistance(xm, ym);
  return d >= 2 && d > autoCorrectBudget(Math.min(xm.length, ym.length)) && skeleton(x) !== skeleton(y);
}

/**
 * Whether two names of as many words differ by more than a slip in some word: "gac motor" is not "GM Motors" ("gac"
 * for "gm"), "mauna kea" not "Mana Peak" ("kea" for "peak"); "blindng lihgts" is Blinding Lights.
 */
function swapsAWord(a: string, b: string): boolean {
  const x = a.split(" ");
  const y = b.split(" ");
  if (x.length < 2 || x.length !== y.length) return false;
  return x.some((w, i) => w !== y[i] && editDistance(w, y[i]) > Math.max(1, autoCorrectBudget(Math.min(w.length, y[i].length))));
}

function closestPerEntry(guess: string, entries: Entry[], inTop10: boolean, useWords = true): Candidate[] {
  const numGuess = numbersAsDigits(guess);
  const guessDigits = digitsOf(numGuess);
  const compactGuess = guess.replace(/ /g, "");
  return entries.map((entry) => {
    let best = Infinity;
    let len = 0;
    let fullName = false;
    let viaWord = false;
    let ends = false;
    let besideShared = false;
    let sameStart = false;
    let sounds = false;
    const { forms, words: nameWordForms, codes } = formsOf(entry);
    const words = useWords ? nameWordForms : [];
    // Words of the name count as forms too, so a misspelled first name ("kareen") lands on its own entry.
    for (const [i, written] of [...forms, ...words].entries()) {
      const isWord = i >= forms.length;
      // Numbers are identity, not spelling: GTA 6 is not GTA 5, Mario Kart 7 is not Mario Kart.
      const formDigits = digitsOf(numbersAsDigits(written));
      if (guessDigits && formDigits !== guessDigits) continue;
      // A number standing as a word of the name isn't spelled by a guess without one: such a guess is only a
      // misspelling of the rest ("harry poter" for "Harry Potter 1"), never the name itself, and never a word put in the
      // number's place ("mario kart ds" is not "Mariokart 8"). One glued to letters is part of a code: "j league" is
      // one slip from "J1 League".
      // Spacing never matters: "spiderman" is "Spider-Man", "psone" PS One. Words both sides share ("mount", "canyon")
      // aren't evidence of a typo: only the rest is compared, so "mount whitney" is not a misspelling of "mount lhotse".
      // Number words count as their digits: "frozen two" is Frozen II.
      const spacing = written.replace(/ /g, "") === compactGuess || (numGuess !== guess && numbersAsDigits(written) === numGuess);
      const unnumbered = !spacing && !guessDigits && formDigits ? numbersAsDigits(written).split(" ").filter((w) => !/^\d+$/.test(w)).join(" ") : written;
      if (!unnumbered) continue;
      const f = unnumbered;
      const [g, rest] = spacing ? [guess, f] : withoutSharedWords(guess, f);
      // Matching a numbered name without its number is weaker than matching a name as written: "avatr" is Avatar, not a
      // tie with "Avatar 2".
      const dist = spacing ? 0 : editDistance(g, rest) + (f !== written ? 0.5 : 0);
      if (dist === 0 && f !== written) continue;
      // Codes (ATL, EDDF, PRC) match exactly or not at all; fuzzy they catch keyboard mash like "asdf".
      if (dist > 0 && !isWord && codes[i]) continue;
      // A name with whole words added or dropped isn't a misspelling of it: "neptune" is not "Neptune I", "cars" is not
      // "Cars 2", "satellite" is not "Satellite Io". Those are parts of names, judged as such in judgeGuess.
      if (dist > 0 && (wordsWithin(g, rest) || wordsWithin(rest, g))) continue;
      // A misspelling keeps its first letter: "factories" is not a typo of Castries. One slip there is fine in a long
      // word, or between letters that sound alike ("kanada"); in a short one it is another word ("kmart" / "WMart").
      if (dist > 1 && g[0] !== rest[0]) continue;
      const swapped = g[0] === rest[1] && g[1] === rest[0];
      if (dist === 1 && !soundAlike(g[0], rest[0]) && !swapped && Math.min(g.length, rest.length) < 8) continue;
      // One word of a longer name only catches a near-exact misspelling of a real word ("kareen" for Kareem), never a
      // different short word: "pope" is not "Don't Bother Me, I Can't Cope".
      if (dist > 0 && isWord && (dist > 1 || g.length < 5 || g[0] !== rest[0])) continue;
      // A whole word typed is never swapped for another: "snapchat" is not Stripchat, "gac motor" not GM Motors.
      if (dist > 1 && (swapsWord(g, rest) || swapsAWord(g, rest))) continue;
      const isName = i === 0;
      if (dist < best || (dist === 0 && isName)) {
        best = dist;
        len = rest.length;
        fullName = dist === 0 && isName;
        viaWord = isWord;
        ends = g[0] === rest[0] && g[g.length - 1] === rest[rest.length - 1];
        // One slip in a short word beside a whole shared word ("john rahm" / "jon rahm"); a three-letter word slipped is
        // another word ("vw bus" is not "VW Bug").
        besideShared = g !== guess && g[0] === rest[0] && g.length >= 4;
        sameStart = g[0] === rest[0];
        sounds = skeleton(g) === skeleton(rest);
      }
    }
    return { entry, inTop10, dist: best, len, fullName, viaWord, ends, besideShared, sameStart, sounds };
  });
}

/**
 * Classify a guess against a puzzle.
 * - correct / duplicate: matches a top-10 entry (exactly or via autocorrect)
 * - near: matches another accepted answer (rank 11+ or unranked), costs a life
 * - typo: could be more than one entry (a shared name, a tied misspelling, a shared word); the player picks, no life lost
 * - unknown: not an accepted answer for this list at all ("asdf", or something the source doesn't cover), no life lost
 *
 * A misspelling that clearly points at one entry resolves to it with `corrected: true` (the game fills the
 * input with that name for the player to confirm), unless what was typed is itself a different real name
 * (Austria when Australia is on the list).
 */
/** `offered`: choices the game just showed for the previous guess; typing or tapping one picks that entry. */
export function judgeGuess(
  raw: string,
  puzzle: Puzzle,
  found: Set<number>,
  lex?: Lexicon,
  offered?: string[],
): Verdict {
  const guess = normalize(raw);
  // On a list of literal strings (passwords), whatever is typed is a guess: nothing is junk or giving up.
  const literal = literalList(puzzle, lex);
  // Giving up is never an answer, unless the list has one called exactly that ("whatever" is a password).
  if (!literal && isGiveUp(raw) && !formIndex(puzzle).has(guess)) return { kind: "unknown", junk: false, giveUp: true };
  if (!guess) return { kind: "empty" };
  // "squid game second season", "second season of squid game": read as "squid game 2" first.
  const numbered = numberedForm(guess);
  if (numbered && numbered !== guess) {
    const r = judgeReading(numbered, numbered, puzzle, found, lex, offered);
    if (r.kind !== "unknown") return r;
  }
  const first = judgeReading(raw, guess, puzzle, found, lex, offered);
  if (definite(first)) return first;
  // Other readings of what was typed ("mt fuji", "la rams", "law n order", "baby shark song", "sims 4" on a list of
  // franchises). One that names an answer exactly beats a correction of the reading as typed ("ncis la" is NCIS: Los
  // Angeles, not NCIS); any beats nothing.
  let fallback: Verdict | undefined;
  for (const { text: alt, exact } of readings(guess, puzzle)) {
    const r = judgeReading(alt, alt, puzzle, found, lex, offered);
    if (definite(r)) return r;
    // Short forms spelled out may also correct or offer, when the answer carries the words: "chi sox" is the Chicago
    // White Sox, but "la defense" is not Los Angeles.
    if (exact || r.kind === "unknown" || r.kind === "empty") continue;
    if (r.kind === "typo" || carries(r.entry, alt.split(" ").filter((w) => !GENERIC.has(w)))) fallback ??= r;
  }
  if (first.kind !== "unknown") return first;
  if (fallback) return fallback;
  if (first.vague || !first.open) return { kind: "unknown", junk: false, ...(first.vague ? { vague: first.vague } : {}) };
  // Nothing here. A real name says so; keyboard mash doesn't look like an answer, unless the list itself is made of
  // such strings or shares a word with it ("tk maxx" beside "T.J. Maxx").
  if (lex && (isKnownName(raw, lex) || isKnownName(guess.replace(/ /g, ""), lex) || isPersonWord(raw, lex))) {
    return { kind: "unknown", junk: false, known: true };
  }
  return { kind: "unknown", junk: !literal && isJunk(raw, lex) && !sharesWord(guess, puzzle) };
}

/** Whether every one of the words is a word of the entry's name or aliases. */
function carries(entry: Entry, words: string[]): boolean {
  const own = new Set(formsOf(entry).forms.flatMap((f) => f.split(" ")));
  return words.every((w) => own.has(w));
}

/** An exact answer: not a correction to confirm, not choices, not nothing. */
function definite(r: Verdict | Reading): boolean {
  return r.kind === "duplicate" || ((r.kind === "correct" || r.kind === "near") && !r.corrected);
}

/** One reading's verdict. `open`: nothing at all fits (no category word, no subject word, no vague fit). */
type Reading = Exclude<GuessResult, { kind: "unknown" }> | { kind: "unknown"; junk: false; vague?: number; open?: true };

function judgeReading(raw: string, guess: string, puzzle: Puzzle, found: Set<number>, lex?: Lexicon, offered?: string[]): Reading {
  // An ordinary word typed alone ("humans", "water") is a word, not part of a name: names that merely contain it
  // aren't readings of it. Names and partial names ("jordan", "shenzhen", "kevin") still are.
  const plain = isPlainWord(raw, lex) && !notableWords(puzzle).has(guess);
  const candidates = [
    ...closestPerEntry(guess, puzzle.answers, true, !plain),
    ...closestPerEntry(guess, puzzle.extras, false, !plain),
  ].sort((a, b) => a.dist - b.dist);

  const best = candidates[0];
  const resolve = (c: Candidate, corrected: boolean): Reading => {
    if (!c.inTop10) return { kind: "near", entry: c.entry, corrected };
    if (found.has(c.entry.rank)) return { kind: "duplicate", entry: c.entry };
    return { kind: "correct", entry: c.entry, corrected };
  };

  // A choice the game just offered, picked by the player, is that entry: no second round of choices.
  const picked = offered?.find((name) => normalize(name) === guess);
  if (picked) {
    const c = candidates.find((x) => x.entry.name === picked);
    if (c) return resolve(c, false);
  }

  /** One candidate resolves; several become choices (ones already found are left out). */
  const choose = (cs: Candidate[], corrected: boolean): Reading => {
    if (cs.length === 1) return resolve(cs[0], corrected);
    const open = cs.filter((c) => !(c.inTop10 && found.has(c.entry.rank)));
    if (open.length === 0) return resolve(cs[0], corrected);
    if (open.length === 1) return resolve(open[0], true);
    // Alphabetical, so the order never hints at which choice is in the top 10.
    const names = open.map((c) => c.entry.name).sort((a, b) => a.localeCompare(b));
    return { kind: "typo", suggestions: names.slice(0, MAX_CHOICES) };
  };

  // An entry's full name beats other entries' aliases: "Avatar" is the 2009 film, not a choice of three.
  // A real name or alias beats a single word of another entry's name: "Britain" is Great Britain (alias),
  // not a choice with New Britain. A name several entries share goes through `fits` below.
  const allExact = candidates.filter((c) => c.dist === 0);
  const strong = allExact.filter((c) => !c.viaWord);
  const exact = strong.length ? strong : allExact;
  const named = exact.filter((c) => c.fullName);
  if (named.length === 1) {
    // An exact name counts ("MrBeast", "Avatar"), unless a more prominent answer also carries it and the exact one is
    // the less likely reading: "avengers" is more likely Endgame (#1) than The Avengers (#15), "pokemon" a Pokémon
    // game than the unranked franchise entry, "the witcher" The Witcher 3 than the 2007 game. Then both are offered,
    // free, rather than a life charged for the less likely reading. When the longer names are no more prominent
    // ("Matterhorn" vs Klein Matterhorn), the exact name is the obvious reading and counts.
    const n = named[0];
    const better = wordMatches(guess, candidates)
      .filter((c) => c !== n && prominence(c) < prominence(n) && !(c.inTop10 && found.has(c.entry.rank)))
      .sort((a, b) => prominence(a) - prominence(b));
    const likelier = better.some((c) => c.inTop10 || (n.entry.rank === 0 && c.entry.rank > 0));
    if (!n.inTop10 && likelier) return choose([n, ...better.slice(0, MAX_CHOICES - 1)], false);
    // Someone else's exact name one slip from a top-10 answer's, beside the same surname, may be that answer misspelled:
    // "Isaiah Thomas" (a 2010s guard) is how most people spell Isiah Thomas (#10). Both are offered, free.
    const spelled = n.inTop10 ? [] : candidates.filter((c) => c.inTop10 && c.dist === 1 && c.besideShared && !c.viaWord && !found.has(c.entry.rank));
    if (spelled.length) return choose([n, ...spelled.slice(0, MAX_TYPO_CHOICES - 1)], false);
    return resolve(n, false);
  }
  /**
   * Several entries fit what was typed. Read it the way a person means it: the most prominent one first ("jordan" is
   * Michael Jordan, #6, not DeAndre Jordan). When one clearly stands out (in the top 10 when the next isn't, or ranked
   * when the next is only in the wider pool), it goes in the box to confirm; once it's found, the next one does.
   * Otherwise the most prominent few are offered. Only a huge spread of unranked names (a common word) asks the
   * player to be more specific.
   *
   * `typed`: what was typed fits these names exactly (not a misspelling). Then a franchise's name doesn't pick a title:
   * when it is only the first words of several titles ("monsters": Monsters University #10, Monsters, Inc. #14), and
   * one of the others is a notable near miss (a figure, ranked within NEAR_MISS_RANK), the title the list ranks higher
   * is not the likelier reading, so the fits are offered, as "toy story" and "incredibles" already are. People and
   * teams keep the natural reading: a surname ("jordan") ends the name rather than starting it, and a first name or a
   * city ("drew", "new york") starts a name whose last word stands alone (`titleHead`).
   */
  const natural = (cs: Candidate[], max: number, typed = false): Reading => {
    const byProminence = (a: Candidate, b: Candidate) =>
      prominence(a) - prominence(b) || nameWordCount(a) - nameWordCount(b) || a.entry.name.localeCompare(b.entry.name);
    const open = cs.filter((c) => !(c.inTop10 && found.has(c.entry.rank))).sort(byProminence);
    if (open.length === 0) return resolve([...cs].sort(byProminence)[0], false);
    // A word shared by three top-10 answers ("toyota" on car models, "china" on banks), or by a crowd with two or more
    // ("tour" on concert tours), is a category on this list, not a name: offering a few, again and again, would hand
    // over the top 10. Two ("avengers", "ed sheeran") are a choice, and one top-10 answer in a crowd ("star wars" on box
    // office) is the natural reading.
    const top10Fits = cs.filter((c) => c.inTop10).length;
    if (top10Fits >= 3 || (cs.length > VAGUE_ABOVE && top10Fits > 1)) return { kind: "unknown", junk: false, vague: cs.length };
    const [top, next] = open;
    if (!next) return resolve(top, true);
    const standsOut = (top.inTop10 && !next.inTop10) || (top.entry.rank > 0 && next.entry.rank === 0);
    const franchise = typed && titleHead(guess, top) && open.some((c) => c !== top && notableNearMiss(c) && titleHead(guess, c));
    if (standsOut && !franchise) return resolve(top, true);
    if (top.entry.rank === 0 && open.length > VAGUE_ABOVE) return { kind: "unknown", junk: false, vague: open.length };
    // Alphabetical, so the order never hints at which choice is in the top 10.
    const names = open.slice(0, max).map((c) => c.entry.name).sort((a, b) => a.localeCompare(b));
    return { kind: "typo", suggestions: names };
  };

  /**
   * Entries that what was typed fits exactly without being any one's full name: a shared alias, or (`part`) whole
   * words of longer names. One entry is that entry: an alias counts at once, part of a name ("Kareem", "american")
   * goes in the box to confirm, so a word that only happens to be in a name never costs a life by itself. Names that
   * are all called that once qualifiers are dropped ("carolina": North and South Carolina; "congo") are offered as
   * equals; anything else takes the natural reading.
   */
  const fits = (cs: Candidate[], part: boolean): Reading => {
    if (cs.length === 1) return resolve(cs[0], part);
    const core = cs.filter((c) => coreName(c.entry.name) === guess);
    if (core.length === 1) return resolve(core[0], part);
    if (core.length > 1 && core.length <= MAX_CHOICES) return choose(core, false);
    return natural(cs, MAX_CHOICES, true);
  };

  // What the list is about ("tour" on concert tours, "museums", "names"), maybe with a small number ("season 3" on
  // Netflix seasons), or a plain category word ("islands") is never read as an answer that merely contains or
  // resembles it. An answer named exactly that still counts: the Instagram account on Instagram accounts (above),
  // "moon" on moons. A year or a longer number is a name's own ("1989 tour").
  // A common category ("pizza" on fast food chains, "basketball" on sports leagues, "meat" on farm products) names a
  // kind of answer, not one: it asks for more whenever some answer carries the word, rather than handing over the one
  // that happens to have it in its name (the audit: "pizza" put Pizza Hut in the box, "basketball" offered three
  // obscure leagues).
  const subject = subjectWords(puzzle.noun);
  const words = guess.split(" ");
  const smallNumber = (w: string) => /^\d{1,2}$/.test(w);
  const category = words.some(isCategory);
  if (words.every((w) => GENERIC.has(w) || subject.has(w) || smallNumber(w) || isCategory(w)) && !words.every(smallNumber)) {
    if (strong.length) return fits(strong, false);
    // A category fits its singular too: "burgers" fits Burger King.
    const singular = category ? words.map(singularOf).join(" ") : guess;
    const fit = new Set([...allExact, ...wordMatches(guess, candidates), ...wordMatches(singular, candidates)].map((c) => c.entry)).size;
    return { kind: "unknown", junk: false, ...(fit > 1 || (category && fit > 0) ? { vague: fit } : {}) };
  }

  if (exact.length > 0) return fits(exact, !strong.length);

  // A country on a list whose entries say which country they're in (islands): that country's islands, offered, the most
  // prominent few (owner: "me typing japan should give me option of the different islands honshu, okinawa, etc.").
  const ofCountry = countryEntries(guess, puzzle, lex);
  if (ofCountry.size) {
    const cs = candidates.filter((c) => ofCountry.has(c.entry));
    const open = cs.filter((c) => !(c.inTop10 && found.has(c.entry.rank))).sort((a, b) => prominence(a) - prominence(b));
    if (open.length === 0) return resolve(cs.sort((a, b) => prominence(a) - prominence(b))[0], false);
    if (open.length === 1) return resolve(open[0], true);
    const names = open.slice(0, MAX_CHOICES).map((c) => c.entry.name).sort((a, b) => a.localeCompare(b));
    return { kind: "typo", suggestions: names };
  }

  // A whole word (or run of words) from a longer name is a short form, not a misspelling. It is checked before
  // near-spellings, which are weaker evidence ("wilt" is two letters from "West").
  const partial = plain ? [] : wordMatches(guess, candidates);
  if (partial.length > 0) return fits(partial, true);

  // An answer's full name with more words after it, usually who made it ("perfect ed sheeran", "stay justin bieber"):
  // that answer, put in the box to confirm. The longest name that starts the guess wins. Not when the whole guess is a
  // name of its own: "saudi aramco" is the company, not Saudi Arabia; "mexico city" is not Mexico.
  // A name of its own, however it's spaced ("golden doodle" is the Goldendoodle, not Golden Retriever).
  const ownName = !!lex && (isKnownName(raw, lex) || (guess.includes(" ") && isKnownName(guess.replace(/ /g, ""), lex)));
  const lead = ownName ? undefined : leadingName(guess, puzzle, lex);
  if (lead) {
    const c = candidates.find((x) => x.entry === lead);
    if (c) return resolve(c, true);
  }

  // Near-spellings are corrected in the input for the player to confirm. Two equally close readings
  // ("Irak": Iran or Iraq) become a choice; more than that is noise, and listing them would leak answers.
  const len = Math.min(guess.length, best?.len ?? guess.length);
  // Six or seven letters get a third edit when the first and last letters agree: a slip in the middle ("hungray").
  // The wider pool's obscure names (no rank, no figure) only take a slip in the middle, with the first and last letters
  // kept: "planes" is not Our Planet. Beside a whole word both share ("rahm"), one slip in a short word is still a
  // slip: "john rahm" is Jon Rahm.
  //
  // What was typed may itself be a real name, and then it is never corrected into a different answer ("Austria" is not
  // Australia), except that a misspelling the bank stores as an alias still finds its own entry ("afganistan" is
  // Afghanistan on every list: `isSlipOf`). Someone's name ("jeremy", "alcaraz") is only corrected by one slip of an
  // answer's own name ("jordon" is Jordan), and on a list of names only to the same name spelled another way
  // ("micheal", "mathew", "erik"), never to a different one ("johnston" is not Johnson, "marie" not Maria). A place
  // outside a regional list's region is only ever named exactly: "praha" is not Praia.
  const person = !ownName && isPersonWord(raw, lex);
  const ofNames = /names$/.test(normalize(puzzle.noun ?? ""));
  const close = candidates.filter((c) => {
    if (c.entry.elsewhere) return false;
    if (ownName && !(c.dist <= 2 && [c.entry.name, ...c.entry.aliases].some((n) => isSlipOf(guess, n, lex)))) return false;
    if (person && !(ofNames ? sameName(guess, normalize(c.entry.name)) : oneSlipOfName(guess, c.entry))) return false;
    // An ordinary word was typed on purpose: one slip at most, keeping its first letter, onto a ranked answer ("hungry"
    // is Hungary; "barrel" is not Brazil, "rice" not the pool's Nice, "doodle" not Poodle). A short word slipped is
    // another word: "hay" is not "ham" (Pork), "car" not "ČR".
    if (plain) return c.dist <= 1 && c.sameStart && c.entry.rank > 0 && guess.length >= 5;
    const notable = c.entry.rank > 0 || c.entry.value !== undefined;
    // The third edit of a slip in the middle needs the same sounds: "korean" is not Kushan, "catalan" not Castilian.
    const budget = typoBudget(len) + (notable && c.ends && c.sounds && len >= 6 && len <= 7 ? 1 : 0);
    return c.dist <= Math.max(budget, c.besideShared ? 1 : 0) && (notable || c.ends);
  });
  if (close.length > 0) {
    const tied = close.filter((c) => c.dist === close[0].dist);
    // As with exact matches, a whole name or alias beats one word of another entry's name: "lotse" is Lhotse, not a
    // choice with Lhotse Middle and Lhotse Shar.
    const named = tied.filter((c) => !c.viaWord);
    const readings = named.length ? named : tied;
    if (readings.length === 1) return resolve(readings[0], true);
    if (readings.length <= MAX_CHOICES) return natural(readings, MAX_TYPO_CHOICES);
  }

  return { kind: "unknown", junk: false, ...(category ? {} : { open: true as const }) };
}

/** Whether `a` is `b` with two neighbouring letters swapped ("micheal" / "michael"). */
function transposed(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const diff = [...a].flatMap((c, i) => (c === b[i] ? [] : [i]));
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

/**
 * Whether two given names are one name spelled two ways: two letters swapped ("micheal"), or the same sounds with the
 * consonants spelled differently ("mathew" / Matthew, "nicolas" / Nicholas, "erik" / Eric, "catherine" / Katherine).
 * Another vowel or consonant is another name: Marie is not Maria, Muller not Miller, Johnston not Johnson.
 */
function sameName(a: string, b: string): boolean {
  const vowels = (s: string) => s.replace(/[^aeiouy]/g, "").replace(/(.)\1+/g, "$1");
  return transposed(a, b) || (skeleton(a) === skeleton(b) && vowels(a) === vowels(b));
}

/** Whether the word is one slip from an entry's own name, or from a word of it ("jordon": Michael Jordan). */
function oneSlipOfName(guess: string, entry: Entry): boolean {
  const name = normalize(entry.name);
  return editDistance(guess, name) <= 1 || name.split(" ").some((w) => w.length >= 4 && editDistance(guess, w) <= 1);
}

/**
 * Common categories of things lists rank: foods and drinks, sports, kinds of produce. Typed alone such a word names a
 * kind of answer ("pizza", "basketball", "meat"), so it never picks the one answer that happens to carry it.
 */
const CATEGORIES = new Set(
  (
    "food snack meal dish drink beverage juice soda coffee tea beer wine milkshake smoothie boba pizza burger hamburger " +
    "cheeseburger sandwich taco burrito kebab donut doughnut bagel bakery bread pastry cake dessert cookie noodle ramen " +
    "sushi fries salad soup steak chicken seafood fish meat fruit vegetable veg veggie grain cereal nut berry dairy " +
    "sport football soccer basketball baseball hockey rugby cricket tennis golf volleyball handball softball lacrosse " +
    "racing motorsport boxing wrestling esport"
  ).split(" "),
);
function singularOf(w: string): string {
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.endsWith("es") && CATEGORIES.has(w.slice(0, -2))) return w.slice(0, -2);
  return w.length > 3 ? w.replace(/s$/, "") : w;
}
function isCategory(w: string): boolean {
  return CATEGORIES.has(w) || CATEGORIES.has(singularOf(w));
}

/** Every normalized name and alias on a list, cached. */
const formCache = new WeakMap<Puzzle, Set<string>>();
function formIndex(puzzle: Puzzle): Set<string> {
  let set = formCache.get(puzzle);
  if (!set) {
    set = new Set();
    for (const e of [...puzzle.answers, ...puzzle.extras]) for (const f of formsOf(e).forms) set.add(f);
    formCache.set(puzzle, set);
  }
  return set;
}

/** Whether some word of the guess is a word of the list's names or aliases ("maxx" beside "T.J. Maxx"). */
const wordCache = new WeakMap<Puzzle, Set<string>>();
function sharesWord(guess: string, puzzle: Puzzle): boolean {
  let set = wordCache.get(puzzle);
  if (!set) {
    set = new Set([...formIndex(puzzle)].flatMap((f) => f.split(" ")));
    wordCache.set(puzzle, set);
  }
  return guess.split(" ").some((w) => w.length >= 3 && set.has(w));
}

/**
 * Whether the list's own answers look like keyboard mash ("qwerty", "111111", "qazwsx": passwords): then nothing
 * typed there is junk or a way of giving up, since anything may be an answer.
 */
const literalCache = new WeakMap<Puzzle, boolean>();
function literalList(puzzle: Puzzle, lex?: Lexicon): boolean {
  if (!lex) return false;
  let v = literalCache.get(puzzle);
  if (v === undefined) {
    let n = 0;
    for (const e of [...puzzle.answers, ...puzzle.extras]) if (isJunk(e.name, lex)) n++;
    literalCache.set(puzzle, (v = n >= 3));
  }
  return v;
}

/** The entries in the country the guess names, on a list whose entries say which country they're in (islands). */
function countryEntries(guess: string, puzzle: Puzzle, lex?: Lexicon): Set<Entry> {
  const out = new Set<Entry>();
  const key = countryKey(guess, lex);
  for (const e of [...puzzle.answers, ...puzzle.extras]) {
    if (!e.country) continue;
    for (const c of Array.isArray(e.country) ? e.country : [e.country]) if (countryKey(c, lex) === key) out.add(e);
  }
  return out;
}

/** Short forms people type for whole words: "mt fuji", "st louis", "ft worth", "law n order". */
const SHORT_FORMS: Record<string, string[]> = {
  mt: ["mount"],
  mtn: ["mountain"],
  mount: ["mt"],
  st: ["saint"],
  saint: ["st"],
  ste: ["sainte"],
  ft: ["fort"],
  n: ["and"],
  and: ["n"],
  u: ["you"],
};
/** Cities as teams' fans shorten them, first word only: "la rams", "ny jets", "tb rays", "chi sox". */
const CITY_SHORT: Record<string, string> = {
  la: "los angeles",
  ny: "new york",
  nyc: "new york",
  sf: "san francisco",
  kc: "kansas city",
  tb: "tampa bay",
  gb: "green bay",
  ne: "new england",
  lv: "las vegas",
  stl: "st louis",
  chi: "chicago",
  philly: "philadelphia",
  nola: "new orleans",
  atl: "atlanta",
};
/** Words that say what kind of thing a title is, not which: "baby shark song", "hello official video". */
const DESCRIPTORS = new Set("song songs video videos mv lyrics lyric audio official single track album movie film show".split(" "));

/**
 * Other ways to read a guess, in order: short forms spelled out ("mt fuji" as "mount fuji", "saint louis" as "st
 * louis", "law n order" as "law and order", "la rams" as "los angeles rams"), descriptors dropped ("baby shark song"),
 * and on a list of franchises, a number dropped ("sims 4" is The Sims, "fifa 23" FIFA). The game tries them when the
 * guess as typed names nothing exactly; normalize() stays as it is (it is the puzzles' contract). `exact`: the reading
 * counts only when it names an answer exactly ("black album" is not read as "black").
 */
export function readings(guess: string, puzzle: Pick<Puzzle, "noun">): { text: string; exact: boolean }[] {
  const words = guess.split(" ");
  const options = words.map((w, i) => [w, ...(SHORT_FORMS[w] ?? []), ...(i === 0 && words.length > 1 && CITY_SHORT[w] ? [CITY_SHORT[w]] : [])]);
  const out: { text: string; exact: boolean }[] = [];
  const add = (text: string, exact: boolean) => {
    if (text && text !== guess && !out.some((r) => r.text === text)) out.push({ text, exact });
  };
  // Every combination of the short forms, capped: "mt st helens" as "mount st helens" and "mount saint helens".
  let combos: string[][] = [[]];
  for (const o of options) combos = combos.flatMap((c) => o.map((w) => [...c, w])).slice(0, 32);
  for (const c of combos) add(c.join(" "), false);
  // "mt denali", "mount denali": the peak goes by its name alone.
  if (words.length > 1 && ["mt", "mount", "mtn"].includes(words[0])) add(words.slice(1).join(" "), true);
  const bare = words.filter((w) => !DESCRIPTORS.has(w));
  if (bare.length && bare.length < words.length) add(bare.join(" "), true);
  if (/\bfranchises?$/.test(normalize(puzzle.noun ?? "")) && words.length > 1 && /^\d+$/.test(numbersAsDigits(words[words.length - 1]))) {
    add(words.slice(0, -1).join(" "), true);
  }
  return out;
}

/** Most choices offered for a name the player actually wrote (a shared alias or a shared word). */
const MAX_CHOICES = 4;
/** Most choices offered for a misspelling. */
const MAX_TYPO_CHOICES = 2;
/** Past this many unranked names sharing a word, the word is too common to guess from: ask for more. */
const VAGUE_ABOVE = 8;
/** A near miss this high, with a figure, is as likely a reading of a franchise's name as the top-10 title. */
const NEAR_MISS_RANK = 20;

function notableNearMiss(c: Candidate): boolean {
  return !c.inTop10 && c.entry.rank > 0 && c.entry.rank <= NEAR_MISS_RANK && c.entry.value !== undefined;
}

/**
 * Whether the guess is the shared start of a title rather than a first name or a city: it is the first words of the
 * name and not all of it ("monsters" in "Monsters University"), and the rest isn't one word the entry answers to by
 * itself. That one word is a surname ("Drew Bledsoe": "Bledsoe") or a team's nickname ("New York Jets": "Jets"), and
 * then the guess only says which one, so the natural reading stands ("drew" is Drew Brees, "new york" the Giants).
 */
function titleHead(guess: string, c: Candidate): boolean {
  const words = normalize(c.entry.name).split(" ");
  const compact = guess.replace(/ /g, "");
  let joined = "";
  for (let i = 0; i < words.length - 1 && joined.length < compact.length; i++) {
    joined += words[i];
    if (joined !== compact) continue;
    const rest = words.slice(i + 1);
    return rest.length > 1 || !c.entry.aliases.some((a) => normalize(a) === rest[0]);
  }
  return false;
}

/** Lower is more prominent: the list's own ranking first, the wider pool after. */
function prominence(c: Candidate): number {
  return c.entry.rank > 0 ? c.entry.rank : Number.MAX_SAFE_INTEGER;
}

function nameWordCount(c: Candidate): number {
  return normalize(c.entry.name).split(" ").length;
}

/** Words too generic to identify an entry on their own. */
const GENERIC = new Set(
  (
    "the of and in on at for new old north south east west central great little big upper lower saint san santa los las " +
    "de la el le du international airport island islands isle lake river mount mountain mountains peak sea ocean bay " +
    "stadium arena park tower building centre center city state states county province republic kingdom united " +
    "national people federal democratic company corporation group bank holdings inc film movie game games series " +
    "capital management asset assets investment investments partners associates technologies advisors " +
    "world cup league club team fc music band bands season seasons part story"
  ).split(" "),
);

/**
 * Words of this list's notable entries (ranked, or with a figure), names and aliases: never plain here, so "swift" is
 * Taylor Swift and "rainier" Mount Rainier where they rank. Elsewhere the lexicon's plain words stay plain: "steel" is
 * not Steel Pier on theme parks just because a film list ranks Man of Steel.
 */
const notableCache = new Map<string, Set<string>>();
function notableWords(puzzle: Puzzle): Set<string> {
  let set = notableCache.get(puzzle.id);
  if (!set) {
    set = new Set();
    for (const e of [...puzzle.answers, ...puzzle.extras]) {
      if (e.rank === 0 && e.value === undefined) continue;
      for (const f of [e.name, ...e.aliases]) for (const w of normalize(f).split(" ")) set.add(w);
    }
    notableCache.set(puzzle.id, set);
  }
  return set;
}

/** Words that only say which instalment a number counts: "season 2", "part 2", "the second season of". */
const INSTALMENT = new Set(["season", "seasons", "series", "part", "chapter", "volume", "of", "the"]);

/** A guess with a number and instalment words, as name plus number ("2 season of squid game" → "squid game 2"). */
function numberedForm(guess: string): string | null {
  const words = numbersAsDigits(guess).split(" ");
  if (!words.some((w) => /^\d+$/.test(w)) || !words.some((w) => INSTALMENT.has(w))) return null;
  const kept = words.filter((w) => !INSTALMENT.has(w));
  const nums = kept.filter((w) => /^\d+$/.test(w));
  const rest = kept.filter((w) => !/^\d+$/.test(w));
  return rest.length && nums.length === 1 ? [...rest, nums[0]].join(" ") : null;
}

/** The words of a list's noun, singular and plural: "concert tours" → concert, tours, tour. */
function subjectWords(noun?: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalize(noun ?? "").split(" ")) {
    if (w.length < 3) continue;
    out.add(w);
    if (w.endsWith("ies")) out.add(`${w.slice(0, -3)}y`);
    else if (w.endsWith("es")) out.add(w.slice(0, -2)).add(w.slice(0, -1));
    else if (w.endsWith("s")) out.add(w.slice(0, -1));
  }
  return out;
}

/** Words that qualify a place's name without being the name: North Carolina, New Jersey, Republic of the Congo. */
const QUALIFIERS = new Set(
  (
    "the of and north south east west northern southern eastern western central new upper lower great democratic " +
    "republic people peoples federal united islamic federation commonwealth state city"
  ).split(" "),
);

/**
 * The entry whose full name or alias makes up the first words of a longer guess ("perfect" in "perfect ed sheeran"),
 * the longest such name first. Names made only of generic words don't count, and a name under four letters ("u2",
 * "bts") only when the rest names the entry ("bts arirang"). When several
 * entries share that name (an artist on each of their tours), the rest of the guess picks one: "ed sheeran divide" is
 * the Divide Tour, "coldplay a head full of dreams" not Coldplay's bigger tour. Otherwise the most prominent.
 *
 * A one-word name followed by more is the longer name of someone or something else unless what follows is who made it,
 * a real name and no other answer here: "perfect ed sheeran" is Perfect, but "fernando torres" is not Fernando (Torres
 * is another player on the list) and "seven nation army" is not Seven. Words that say what kind of thing it is don't
 * count ("baby shark song").
 */
function leadingName(guess: string, puzzle: Puzzle, lex?: Lexicon): Entry | undefined {
  const entries = [...puzzle.answers, ...puzzle.extras];
  const words = guess.split(" ");
  const forms = (e: Entry) => [e.name, ...e.aliases].map(normalize);
  const numbersOf = (s: string) => digitsOf(numbersAsDigits(s)).split(" ");
  // What the list is about says nothing about who made it: "french language", "citadel hedge fund", "wicked broadway".
  const subject = subjectWords(puzzle.noun);
  for (let k = words.length - 1; k >= 1; k--) {
    const head = words.slice(0, k).join(" ");
    if (words.slice(0, k).every((w) => GENERIC.has(w))) continue;
    // A short name ("u2", "bts") counts only to pick among the entries it shares by the rest ("u2 vertigo").
    const short = head.replace(/ /g, "").length < 4;
    // A number after the name names a different one: "frozen 3" is not Frozen, "bridgerton 2" not its first season,
    // "modern warfare 2" not Modern Warfare (2019). Whole numbers: 2 is not in 2019.
    const restDigits = digitsOf(numbersAsDigits(words.slice(k).join(" ")));
    const rest = words.slice(k).filter((w) => w.length >= 2 && !GENERIC.has(w) && !DESCRIPTORS.has(w) && !subject.has(w));
    // Part of a name followed by something that isn't in it is someone or something else: "charli xcx" is not Charli
    // D'Amelio, "stranger things final season" not Season 4. A whole name followed by who made it still reads.
    const elsewhere = (e: Entry) => {
      const name = normalize(e.name).split(" ");
      return head !== normalize(e.name) && head.split(" ").every((w) => name.includes(w)) && rest.some((w) => !name.includes(w));
    };
    const hits = entries.filter(
      (e) =>
        forms(e).includes(head) &&
        !elsewhere(e) &&
        (!restDigits || forms(e).some((f) => restDigits.split(" ").every((d) => numbersOf(f).includes(d)))),
    );
    if (hits.length === 0) continue;
    const named = hits.filter((e) => forms(e).some((f) => rest.every((w) => f.split(" ").includes(w))));
    // The rest misspelling the name's own words is the name: "harry poter" is Harry Potter.
    const ownWords = (e: Entry) => normalize(e.name).split(" ");
    const spelled = hits.some((e) => rest.every((w) => ownWords(e).some((x) => x.length >= 4 && editDistance(w, x) <= 1)));
    if (k === 1 && rest.length && !restDigits && !named.length && !spelled) {
      const maker = rest.filter((w, i) => !(i === 0 && w === "by")).join(" ");
      const compact = maker.replace(/ /g, "");
      // Another answer here goes by it, or by a name with it in ("torres" is José Torres's; an ordinary word such as
      // "motor" or "terrier" names no one). Ordinary words that name nothing together are a longer title, not who made
      // it: "seven nation army", "lassie come home" ("sunflower spider-man" is the song from Spider-Man).
      const phrase = maker.split(" ");
      const plainPhrase = !!lex && phrase.every((w) => isPlainWord(w, lex));
      const other = entries.some((e) => {
        const f = formsOf(e).forms;
        return !hits.includes(e) && (f.includes(maker) || (!plainPhrase && hasWordSpan(f[0].split(" "), compact)));
      });
      if (other || (plainPhrase && phrase.length > 1 && !isKnownName(maker, lex))) continue;
    }
    if (short) {
      if (rest.length && named.length) return mostProminent(named);
      continue;
    }
    if (hits.length === 1) return hits[0];
    return mostProminent(rest.length && named.length ? named : hits);
  }
  return undefined;
}

function mostProminent(entries: Entry[]): Entry | undefined {
  const rank = (e: Entry) => (e.rank > 0 ? e.rank : Number.MAX_SAFE_INTEGER);
  return [...entries].sort((a, b) => rank(a) - rank(b))[0];
}

/** A name without its qualifiers: "Democratic Republic of the Congo" → congo, "North Carolina" → carolina. */
function coreName(name: string): string {
  return normalize(name)
    .split(" ")
    .filter((w) => !QUALIFIERS.has(w))
    .join(" ");
}

/** Distinctive single words of a multi-word name: "Kareem Abdul-Jabbar" → kareem, abdul, jabbar. */
function nameWords(name: string): string[] {
  const words = normalize(name).split(" ");
  return words.length > 1 ? words.filter((w) => w.length >= 4 && !GENERIC.has(w)) : [];
}

/**
 * Entries whose name contains the guess as whole words. Names only: redirect aliases include phrases like
 * "Russell–Chamberlain rivalry", which would make "Russell" point at Wilt Chamberlain.
 */
function wordMatches(guess: string, candidates: Candidate[]): Candidate[] {
  const words = guess.split(" ");
  const compact = guess.replace(/ /g, "");
  if (compact.length < 4 || words.every((w) => GENERIC.has(w))) return [];
  // Two or more distinctive words, in the name's order with some left out: "renaissance tour" is the Renaissance World
  // Tour, "lord rings" The Lord of the Rings. Partial knowledge, put in the box to confirm.
  const gapped = words.filter((w) => !GENERIC.has(w)).length >= 2;
  return candidates.filter(({ entry }) => {
    const nameWords = normalize(entry.name).split(" ");
    return hasWordSpan(nameWords, compact) || (gapped && inOrder(nameWords, words));
  });
}

/** Whether every word of the guess is a word of the name, in the same order: "1989 tour" in "1989 world tour". */
function inOrder(nameWords: string[], words: string[]): boolean {
  let i = 0;
  for (const w of words) {
    while (i < nameWords.length && nameWords[i] !== w) i++;
    if (i === nameWords.length) return false;
    i++;
  }
  return true;
}

/** Whether consecutive words of a name, joined without spaces, spell the guess ("spiderman" in "spider man no way home"). */
function hasWordSpan(nameWords: string[], compact: string): boolean {
  for (let i = 0; i < nameWords.length; i++) {
    let joined = "";
    for (let j = i; j < nameWords.length && joined.length < compact.length; j++) {
      joined += nameWords[j];
      if (joined === compact) return true;
    }
  }
  return false;
}
