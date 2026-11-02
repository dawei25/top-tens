import { isJunk, isKnownName, isPlainWord, type Lexicon } from "./junk";
import type { Entry, GuessResult, Puzzle } from "./types";

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
function numbersAsDigits(s: string): string {
  return s
    .split(" ")
    .map((w) => NUMBER_WORDS[w] ?? w)
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
    const forms = [entry.name, ...entry.aliases];
    const words = useWords ? nameWords(entry.name) : [];
    // Words of the name count as forms too, so a misspelled first name ("kareen") lands on its own entry.
    for (const [i, form] of [...forms, ...words].entries()) {
      const f = normalize(form);
      // Numbers are identity, not spelling: GTA 6 is not GTA 5, Mario Kart 7 is not Mario Kart.
      if (guessDigits && digitsOf(numbersAsDigits(f)) !== guessDigits) continue;
      // Spacing never matters: "spiderman" is "Spider-Man". Words both sides share ("mount", "canyon") aren't
      // evidence of a typo: only the rest is compared, so "mount whitney" is not a misspelling of "mount lhotse".
      // Number words count as their digits: "frozen two" is Frozen II.
      const spacing = f.replace(/ /g, "") === compactGuess || (numGuess !== guess && numbersAsDigits(f) === numGuess);
      const [g, rest] = spacing ? [guess, f] : withoutSharedWords(guess, f);
      const dist = spacing ? 0 : editDistance(g, rest);
      // Codes (ATL, EDDF, PRC) match exactly or not at all; fuzzy they catch keyboard mash like "asdf".
      if (dist > 0 && CODE.test(form)) continue;
      // A name with whole words added or dropped isn't a misspelling of it: "neptune" is not "Neptune I", "cars" is not
      // "Cars 2", "satellite" is not "Satellite Io". Those are parts of names, judged as such in judgeGuess.
      if (dist > 0 && (wordsWithin(g, rest) || wordsWithin(rest, g))) continue;
      // A misspelling keeps its first letter: "factories" is not a typo of Castries. One slip anywhere is still fine.
      if (dist > 1 && g[0] !== rest[0]) continue;
      // One word of a longer name only catches a near-exact misspelling of a real word ("kareen" for Kareem), never a
      // different short word: "pope" is not "Don't Bother Me, I Can't Cope".
      if (dist > 0 && i >= forms.length && (dist > 1 || g.length < 5 || g[0] !== rest[0])) continue;
      if (dist < best || (dist === 0 && form === entry.name)) {
        best = dist;
        len = rest.length;
        fullName = dist === 0 && form === entry.name;
        viaWord = i >= forms.length;
        ends = g[0] === rest[0] && g[g.length - 1] === rest[rest.length - 1];
      }
    }
    return { entry, inTop10, dist: best, len, fullName, viaWord, ends };
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
): GuessResult {
  const guess = normalize(raw);
  if (!guess) return { kind: "empty" };

  // An ordinary word typed alone ("humans", "water") is a word, not part of a name: names that merely contain it
  // aren't readings of it. Names and partial names ("jordan", "shenzhen", "kevin") still are.
  const plain = isPlainWord(raw, lex);
  const candidates = [
    ...closestPerEntry(guess, puzzle.answers, true, !plain),
    ...closestPerEntry(guess, puzzle.extras, false, !plain),
  ].sort((a, b) => a.dist - b.dist);

  const best = candidates[0];
  const resolve = (c: Candidate, corrected: boolean): GuessResult => {
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
  const choose = (cs: Candidate[], corrected: boolean): GuessResult => {
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
    return resolve(n, false);
  }
  /**
   * Several entries fit what was typed. Read it the way a person means it: the most prominent one first ("jordan" is
   * Michael Jordan, #6, not DeAndre Jordan). When one clearly stands out (in the top 10 when the next isn't, or ranked
   * when the next is only in the wider pool), it goes in the box to confirm; once it's found, the next one does.
   * Otherwise the most prominent few are offered. Only a huge spread of unranked names (a common word) asks the
   * player to be more specific.
   */
  const natural = (cs: Candidate[], max: number): GuessResult => {
    const byProminence = (a: Candidate, b: Candidate) =>
      prominence(a) - prominence(b) || nameWordCount(a) - nameWordCount(b) || a.entry.name.localeCompare(b.entry.name);
    const open = cs.filter((c) => !(c.inTop10 && found.has(c.entry.rank))).sort(byProminence);
    if (open.length === 0) return resolve([...cs].sort(byProminence)[0], false);
    const [top, next] = open;
    if (!next) return resolve(top, true);
    const standsOut = (top.inTop10 && !next.inTop10) || (top.entry.rank > 0 && next.entry.rank === 0);
    if (standsOut) return resolve(top, true);
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
  const fits = (cs: Candidate[], part: boolean): GuessResult => {
    if (cs.length === 1) return resolve(cs[0], part);
    const core = cs.filter((c) => coreName(c.entry.name) === guess);
    if (core.length === 1) return resolve(core[0], part);
    if (core.length > 1 && core.length <= MAX_CHOICES) return choose(core, false);
    return natural(cs, MAX_CHOICES);
  };

  if (exact.length > 0) return fits(exact, !strong.length);

  // A whole word (or run of words) from a longer name is a short form, not a misspelling. It is checked before
  // near-spellings, which are weaker evidence ("wilt" is two letters from "West").
  const partial = plain ? [] : wordMatches(guess, candidates);
  if (partial.length > 0) return fits(partial, true);

  // An answer's full name with more words after it, usually who made it ("perfect ed sheeran", "stay justin bieber"):
  // that answer, put in the box to confirm. The longest name that starts the guess wins. Not when the whole guess is a
  // name of its own: "saudi aramco" is the company, not Saudi Arabia; "mexico city" is not Mexico.
  const lead = lex && isKnownName(raw, lex) ? undefined : leadingName(guess, [...puzzle.answers, ...puzzle.extras]);
  if (lead) {
    const c = candidates.find((x) => x.entry === lead);
    if (c) return resolve(c, true);
  }

  // A plain category word ("islands", "lake", "city") is never a misspelling of an answer.
  if (guess.split(" ").every((w) => GENERIC.has(w))) return { kind: "unknown", junk: false };

  // Near-spellings are corrected in the input for the player to confirm. Two equally close readings
  // ("Irak": Iran or Iraq) become a choice; more than that is noise, and listing them would leak answers.
  const len = Math.min(guess.length, best?.len ?? guess.length);
  // Six or seven letters get a third edit when the first and last letters agree: a slip in the middle ("hungray").
  const close = candidates.filter((c) => c.dist <= typoBudget(len) + (c.ends && len >= 6 && len <= 7 ? 1 : 0));
  if (close.length > 0 && !(lex && isKnownName(raw, lex))) {
    const tied = close.filter((c) => c.dist === close[0].dist);
    // As with exact matches, a whole name or alias beats one word of another entry's name: "lotse" is Lhotse, not a
    // choice with Lhotse Middle and Lhotse Shar.
    const named = tied.filter((c) => !c.viaWord);
    const readings = named.length ? named : tied;
    if (readings.length === 1) return resolve(readings[0], true);
    if (readings.length <= MAX_CHOICES) return natural(readings, MAX_TYPO_CHOICES);
  }

  return { kind: "unknown", junk: isJunk(raw, lex) };
}

/** Most choices offered for a name the player actually wrote (a shared alias or a shared word). */
const MAX_CHOICES = 4;
/** Most choices offered for a misspelling. */
const MAX_TYPO_CHOICES = 2;
/** Past this many unranked names sharing a word, the word is too common to guess from: ask for more. */
const VAGUE_ABOVE = 8;

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
    "world cup league club team fc"
  ).split(" "),
);

/** Words that qualify a place's name without being the name: North Carolina, New Jersey, Republic of the Congo. */
const QUALIFIERS = new Set(
  (
    "the of and north south east west northern southern eastern western central new upper lower great democratic " +
    "republic people peoples federal united islamic federation commonwealth state city"
  ).split(" "),
);

/**
 * The entry whose full name or alias makes up the first words of a longer guess ("perfect" in "perfect ed sheeran"),
 * the longest such name first. Names under four letters or made only of generic words don't count. When several
 * entries share that name (an artist on each of their tours), the rest of the guess picks one: "ed sheeran divide" is
 * the Divide Tour, "coldplay a head full of dreams" not Coldplay's bigger tour. Otherwise the most prominent.
 */
function leadingName(guess: string, entries: Entry[]): Entry | undefined {
  const words = guess.split(" ");
  const forms = (e: Entry) => [e.name, ...e.aliases].map(normalize);
  for (let k = words.length - 1; k >= 1; k--) {
    const head = words.slice(0, k).join(" ");
    if (head.replace(/ /g, "").length < 4 || words.slice(0, k).every((w) => GENERIC.has(w))) continue;
    const hits = entries.filter((e) => forms(e).includes(head));
    if (hits.length <= 1) {
      if (hits.length) return hits[0];
      continue;
    }
    const rest = words.slice(k).filter((w) => w.length >= 2 && !GENERIC.has(w));
    const named = hits.filter((e) => forms(e).some((f) => rest.every((w) => f.split(" ").includes(w))));
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
