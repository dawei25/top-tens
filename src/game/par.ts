/**
 * Par and score distributions per list (public/puzzles/par.json, from scripts/judge/par.ts). Until real players'
 * scores are collected the distributions are estimates from the list judge's simulated players, and say so.
 */
export interface ListPar {
  /** The median score out of 10: what a typical player gets. */
  par: number;
  /** How many players scored 0, 1, ... 10. */
  counts: number[];
  /** 1 (anyone) to 5 (enthusiasts), from the list judge. */
  difficulty?: number;
  /** Topic tags, broad first ("sports", "basketball", "nba"). */
  tags?: string[];
  /** True while the counts are a synthetic crowd rather than real players. */
  estimated?: boolean;
}

export type ParFile = Record<string, ListPar>;

let cache: Promise<ParFile> | undefined;

/** par.json, loaded once; an empty map if it's missing, so the game never depends on it. */
export function loadPar(): Promise<ParFile> {
  cache ??= fetch(`${import.meta.env.BASE_URL}puzzles/par.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return cache;
}

/**
 * The share of players a score beats, 0-100: everyone below it, plus half of those who tied (the usual
 * percentile-rank convention, so a score in the middle of a big tie lands mid-pack instead of at the top).
 */
export function percentile(counts: number[], score: number): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  const below = counts.slice(0, Math.max(0, score)).reduce((a, b) => a + b, 0);
  const tied = counts[score] ?? 0;
  return Math.round((100 * (below + tied / 2)) / total);
}

/** "Top 8%" for strong scores, "better than 40%" otherwise: whichever reads better. */
export function percentileLabel(p: number): string {
  return p >= 50 ? `top ${Math.max(1, 100 - p)}%` : `better than ${p}%`;
}
