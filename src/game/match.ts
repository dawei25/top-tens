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
 * - typo: close to more than one entry, or probably a misspelled non-top-10 answer; the player picks, no life lost
 * - unknown: not an accepted answer for this list at all ("asdf", or something the source doesn't cover), no life lost
 *
 * A misspelling that clearly points at one top-10 entry counts as that entry, unless what was typed is
 * itself a different real name (Austria when Australia is on the list).
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

  if (best && best.dist === 0) return resolve(best, false);

  const len = Math.min(guess.length, best?.len ?? guess.length);
  const close = candidates.filter((c) => c.dist <= typoBudget(len));
  if (close.length > 0 && !(lex && isKnownName(raw, lex))) {
    const tied = close.filter((c) => c.dist === close[0].dist);
    if (tied.length === 1) {
      const c = tied[0];
      if (c.inTop10 || c.dist <= autoCorrectBudget(len)) return resolve(c, true);
      // Probably a misspelled rank 11+ answer: let the player confirm before it costs a life.
      return { kind: "typo", suggestions: [c.entry.name] };
    }
    return { kind: "typo", suggestions: tied.slice(0, 3).map((c) => c.entry.name) };
  }

  return { kind: "unknown", junk: isJunk(raw, lex) };
}
