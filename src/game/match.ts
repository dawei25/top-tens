import { isJunk, type Lexicon } from "./junk";
import type { Entry, GuessResult, Puzzle } from "./types";

const LEADING_ARTICLE = /^(the|a|an)\s+/;

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(LEADING_ARTICLE, "");
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
  return entries.map((entry) => {
    let best = Infinity;
    let len = 0;
    for (const form of [entry.name, ...entry.aliases]) {
      const f = normalize(form);
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
 * - near: matches a rank 11+ entry, costs a life
 * - typo: close to something but not confidently one entry, no life lost
 * - junk: matches nothing and doesn't look like a real word or name ("asdf"), no life lost
 * - wrong: a plausible answer that isn't on the list, costs a life
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
  const auto = candidates.filter((c) => c.dist <= autoCorrectBudget(len));
  if (auto.length > 0) {
    const tied = auto.filter((c) => c.dist === auto[0].dist);
    if (tied.length === 1) return resolve(tied[0], true);
    return { kind: "typo", suggestions: tied.map((c) => c.entry.name) };
  }

  const close = candidates.filter((c) => c.dist <= typoBudget(len));
  if (close.length > 0) {
    return { kind: "typo", suggestions: close.slice(0, 3).map((c) => c.entry.name) };
  }

  return isJunk(raw, lex) ? { kind: "junk" } : { kind: "wrong" };
}
