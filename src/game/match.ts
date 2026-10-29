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

/** Edits within which we treat a guess as a probable misspelling (no life lost). */
export function typoBudget(len: number): number {
  return autoCorrectBudget(len) + 1;
}

interface Candidate {
  entry: Entry;
  inTop10: boolean;
  dist: number;
  len: number;
}

function closestPerEntry(guess: string, entries: Entry[], inTop10: boolean): Candidate[] {
  const guessDigits = digitsOf(guess);
  return entries.map((entry) => {
    let best = Infinity;
    let len = 0;
    for (const form of [entry.name, ...entry.aliases]) {
      const f = normalize(form);
      // Numbers are identity, not spelling: GTA 6 is not GTA 5, Mario Kart 7 is not Mario Kart.
      if (guessDigits && digitsOf(f) !== guessDigits) continue;
      const dist = editDistance(guess, f);
      if (dist < best) {
        best = dist;
        len = f.length;
      }
    }
    return { entry, inTop10, dist: best, len };
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
export function judgeGuess(raw: string, puzzle: Puzzle, found: Set<number>, lex?: Lexicon): GuessResult {
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

  // A name several entries share ("New Zealand" for North and South Island) offers each of them.
  const exact = candidates.filter((c) => c.dist === 0);
  if (exact.length > 0) return choose(exact, false);

  const len = Math.min(guess.length, best?.len ?? guess.length);
  const close = candidates.filter((c) => c.dist <= typoBudget(len));
  if (close.length > 0 && !(lex && isKnownName(raw, lex))) {
    return choose(close.filter((c) => c.dist === close[0].dist), true);
  }

  // A distinctive word from a longer name: "Haneda" for Tokyo Haneda Airport.
  const partial = wordMatches(guess, candidates);
  if (partial.length > 0 && partial.length <= MAX_CHOICES) return choose(partial, true);

  return { kind: "unknown", junk: isJunk(raw, lex) };
}

const MAX_CHOICES = 4;

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

/** Entries where the guess appears as whole words inside the name or an alias. */
function wordMatches(guess: string, candidates: Candidate[]): Candidate[] {
  const words = guess.split(" ");
  if (guess.replace(/ /g, "").length < 4 || words.every((w) => GENERIC.has(w))) return [];
  return candidates.filter(({ entry }) =>
    [entry.name, ...entry.aliases].some((form) => ` ${normalize(form)} `.includes(` ${guess} `)),
  );
}
