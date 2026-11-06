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
        besideShared = g !== guess && g[0] === rest[0];
        sameStart = g[0] === rest[0];
      }
    }
    return { entry, inTop10, dist: best, len, fullName, viaWord, ends, besideShared, sameStart };
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
  // "squid game second season", "second season of squid game": read as "squid game 2" first.
  const numbered = numberedForm(guess);
  if (numbered && numbered !== guess) {
    const r = judgeGuess(numbered, puzzle, found, lex, offered);
    if (r.kind !== "unknown") return r;
  }

  // An ordinary word typed alone ("humans", "water") is a word, not part of a name: names that merely contain it
  // aren't readings of it. Names and partial names ("jordan", "shenzhen", "kevin") still are.
  const plain = isPlainWord(raw, lex) && !notableWords(puzzle).has(guess);
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
   *
   * `typed`: what was typed fits these names exactly (not a misspelling). Then a franchise's name doesn't pick a title:
   * when it is only the first words of several titles ("monsters": Monsters University #10, Monsters, Inc. #14), and
   * one of the others is a notable near miss (a figure, ranked within NEAR_MISS_RANK), the title the list ranks higher
   * is not the likelier reading, so the fits are offered, as "toy story" and "incredibles" already are. People and
   * teams keep the natural reading: a surname ("jordan") ends the name rather than starting it, and a first name or a
   * city ("drew", "new york") starts a name whose last word stands alone (`titleHead`).
   */
  const natural = (cs: Candidate[], max: number, typed = false): GuessResult => {
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
  const fits = (cs: Candidate[], part: boolean): GuessResult => {
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
  const subject = subjectWords(puzzle.noun);
  const words = guess.split(" ");
  const smallNumber = (w: string) => /^\d{1,2}$/.test(w);
  if (words.every((w) => GENERIC.has(w) || subject.has(w) || smallNumber(w)) && !words.every(smallNumber)) {
    if (strong.length) return fits(strong, false);
    const fit = new Set([...allExact, ...wordMatches(guess, candidates)].map((c) => c.entry)).size;
    return { kind: "unknown", junk: false, ...(fit > 1 ? { vague: fit } : {}) };
  }

  if (exact.length > 0) return fits(exact, !strong.length);

  // A whole word (or run of words) from a longer name is a short form, not a misspelling. It is checked before
  // near-spellings, which are weaker evidence ("wilt" is two letters from "West").
  const partial = plain ? [] : wordMatches(guess, candidates);
  if (partial.length > 0) return fits(partial, true);

  // An answer's full name with more words after it, usually who made it ("perfect ed sheeran", "stay justin bieber"):
  // that answer, put in the box to confirm. The longest name that starts the guess wins. Not when the whole guess is a
  // name of its own: "saudi aramco" is the company, not Saudi Arabia; "mexico city" is not Mexico.
  // A name of its own, however it's spaced ("golden doodle" is the Goldendoodle, not Golden Retriever).
  const ownName = !!lex && (isKnownName(raw, lex) || (guess.includes(" ") && isKnownName(guess.replace(/ /g, ""), lex)));
  const lead = ownName ? undefined : leadingName(guess, [...puzzle.answers, ...puzzle.extras]);
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
  const close = candidates.filter((c) => {
    // An ordinary word was typed on purpose: one slip at most, keeping its first letter, onto a ranked answer ("hungry"
    // is Hungary; "barrel" is not Brazil, "rice" not the pool's Nice, "doodle" not Poodle).
    if (plain) return c.dist <= 1 && c.sameStart && c.entry.rank > 0;
    const notable = c.entry.rank > 0 || c.entry.value !== undefined;
    const budget = typoBudget(len) + (notable && c.ends && len >= 6 && len <= 7 ? 1 : 0);
    return c.dist <= Math.max(budget, c.besideShared ? 1 : 0) && (notable || c.ends);
  });
  if (close.length > 0 && !ownName) {
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
 */
function leadingName(guess: string, entries: Entry[]): Entry | undefined {
  const words = guess.split(" ");
  const forms = (e: Entry) => [e.name, ...e.aliases].map(normalize);
  for (let k = words.length - 1; k >= 1; k--) {
    const head = words.slice(0, k).join(" ");
    if (words.slice(0, k).every((w) => GENERIC.has(w))) continue;
    // A short name ("u2", "bts") counts only to pick among the entries it shares by the rest ("u2 vertigo").
    const short = head.replace(/ /g, "").length < 4;
    // A number after the name names a different one: "frozen 3" is not Frozen, "bridgerton 2" not its first season.
    const restDigits = digitsOf(numbersAsDigits(words.slice(k).join(" ")));
    const rest = words.slice(k).filter((w) => w.length >= 2 && !GENERIC.has(w));
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
        (!restDigits || forms(e).some((f) => digitsOf(numbersAsDigits(f)).includes(restDigits))),
    );
    if (hits.length === 0) continue;
    const named = hits.filter((e) => forms(e).some((f) => rest.every((w) => f.split(" ").includes(w))));
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
