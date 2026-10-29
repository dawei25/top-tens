import { isJunk, isKnownName, type Lexicon } from "./junk";
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

function digitsOf(s: string): string {
  return (s.match(/\d+/g) ?? []).join(" ");
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

/** Edits we silently accept as the same word. */
export function autoCorrectBudget(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 10) return 2;
  return 3;
}

/**
 * Edits within which a guess is treated as a misspelling and corrected in the input. Short words get no extra
 * slack: two changed letters out of four ("wilt" / "west") is a different word, not a typo.
 */
export function typoBudget(len: number): number {
  return autoCorrectBudget(len) + (len <= 5 ? 0 : 1);
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
}

function closestPerEntry(guess: string, entries: Entry[], inTop10: boolean): Candidate[] {
  const guessDigits = digitsOf(guess);
  const compactGuess = guess.replace(/ /g, "");
  return entries.map((entry) => {
    let best = Infinity;
    let len = 0;
    let fullName = false;
    let viaWord = false;
    const forms = [entry.name, ...entry.aliases];
    const words = nameWords(entry.name);
    // Words of the name count as forms too, so a misspelled first name ("kareen") lands on its own entry.
    for (const [i, form] of [...forms, ...words].entries()) {
      const f = normalize(form);
      // Numbers are identity, not spelling: GTA 6 is not GTA 5, Mario Kart 7 is not Mario Kart.
      if (guessDigits && digitsOf(f) !== guessDigits) continue;
      // Spacing never matters: "spiderman" is "Spider-Man".
      const dist = f.replace(/ /g, "") === compactGuess ? 0 : editDistance(guess, f);
      // Codes (ATL, EDDF, PRC) match exactly or not at all; fuzzy they catch keyboard mash like "asdf".
      if (dist > 0 && CODE.test(form)) continue;
      if (dist < best || (dist === 0 && form === entry.name)) {
        best = dist;
        len = f.length;
        fullName = dist === 0 && form === entry.name;
        viaWord = i >= forms.length;
      }
    }
    return { entry, inTop10, dist: best, len, fullName, viaWord };
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

  const candidates = [
    ...closestPerEntry(guess, puzzle.answers, true),
    ...closestPerEntry(guess, puzzle.extras, false),
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
  // Otherwise a name several entries share ("New Zealand" for North and South Island) offers each of them.
  // A real name or alias beats a single word of another entry's name: "Britain" is Great Britain (alias),
  // not a choice with New Britain.
  const allExact = candidates.filter((c) => c.dist === 0);
  const strong = allExact.filter((c) => !c.viaWord);
  const exact = strong.length ? strong : allExact;
  const named = exact.filter((c) => c.fullName);
  if (named.length === 1) {
    // The exact name of a ranked entry counts ("MrBeast", "Avatar"). The exact name of an unranked pool entry that a
    // ranked entry's name contains ("The Witcher", the 2007 game, vs The Witcher 3: Wild Hunt) is ambiguous: offer
    // them rather than charge a life for the less likely reading. When every longer name is unranked too
    // ("Matterhorn" vs Klein Matterhorn), the exact name is the obvious reading and counts.
    const containing = wordMatches(guess, candidates).filter((c) => c !== named[0]);
    const ambiguous = containing.some((c) => c.entry.rank > 0);
    if (named[0].entry.rank === 0 && ambiguous && containing.length < MAX_CHOICES) {
      return choose([named[0], ...containing], false);
    }
    return resolve(named[0], false);
  }
  if (exact.length > 0) return choose(exact, false);

  // A whole word from a longer name ("Kareem" for Kareem Abdul-Jabbar, "Haneda" for Tokyo Haneda Airport) is a
  // correct short form, not a misspelling: if it names one entry it counts like an alias. It is checked before
  // near-spellings, which are weaker evidence ("wilt" is two letters from "West").
  const partial = wordMatches(guess, candidates);
  if (partial.length === 1) return resolve(partial[0], false);
  if (partial.length > 1 && partial.length <= MAX_CHOICES) return choose(partial, true);

  // Near-spellings are corrected in the input for the player to confirm. Two equally close readings
  // ("Irak": Iran or Iraq) become a choice; more than that is noise, and listing them would leak answers.
  const len = Math.min(guess.length, best?.len ?? guess.length);
  const close = candidates.filter((c) => c.dist <= typoBudget(len));
  if (close.length > 0 && !(lex && isKnownName(raw, lex))) {
    const tied = close.filter((c) => c.dist === close[0].dist);
    if (tied.length <= MAX_TYPO_CHOICES) return choose(tied, true);
  }

  return { kind: "unknown", junk: isJunk(raw, lex) };
}

/** Most choices offered for a name the player actually wrote (a shared alias or a shared word). */
const MAX_CHOICES = 4;
/** Most choices offered for a misspelling. */
const MAX_TYPO_CHOICES = 2;

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
  return candidates.filter(({ entry }) => hasWordSpan(normalize(entry.name).split(" "), compact));
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
