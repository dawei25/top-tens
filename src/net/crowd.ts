import { percentile } from "../game/par";

/**
 * Real players' scores on a list (list_stats in the database): one score per player, their first game on the list
 * in that mode, so replays and repeat submissions don't tilt it.
 */
export interface CrowdStats {
  /** Players counted. */
  n: number;
  /** Lists: players per score 0-10. Blitz: players per 50-point bucket (0-49, 50-99, ...). */
  counts: number[];
  /** Mean score, when there are players. */
  avg: number | null;
}

/**
 * W: how many players the estimate counts as. A list's estimate (par.json: a synthetic crowd from the list judges'
 * simulated players) is never switched off at some player count; it stands for W virtual players, spread like the
 * estimate, and each real player's first try joins them. The counts drawn are W x the estimate's share of each score
 * plus the real counts, and "better than X%" ranks the score among them. The first real players (often the owner's
 * testers, who know the lists) move the curve 1/31 each; 30 weigh as much as the estimate; 300 make it about 91% real.
 * Small enough that real players take over within a few hundred games, big enough that a handful can't swing a list.
 * While real players number fewer than W the estimate outweighs them, and the results say "(estimated)".
 */
export const ESTIMATE_WEIGHT = 30;
/**
 * Stats' "Vs players" compares your average with real players' alone (list_averages: nothing to blend there), on
 * lists at least this many players have finished.
 */
export const MIN_PLAYERS = 50;
/** Blitz scores are counted in buckets this many points wide. */
export const BLITZ_BUCKET = 50;
const MAX_BLITZ_BUCKET = 100;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * The players to draw and rank against: the estimate as ESTIMATE_WEIGHT virtual players (its share of each score
 * times W) plus the real players' counts. With no real players it is the estimate itself, the same array, so a list
 * nobody has played reads exactly as before; with no estimate (Blitz, a list missing from par.json) the real counts
 * alone. Lists have 11 scores; Blitz buckets run as far as either side reaches (a missing bucket counts 0).
 */
export function blendCounts(estimate: number[] | undefined, real: CrowdStats | null | undefined): number[] {
  const total = estimate ? sum(estimate) : 0;
  if (!estimate || !total) return real?.counts ?? [];
  if (!real || !real.n) return estimate;
  return Array.from(
    { length: Math.max(estimate.length, real.counts.length) },
    (_, i) => ((estimate[i] ?? 0) * ESTIMATE_WEIGHT) / total + (real.counts[i] ?? 0),
  );
}

/**
 * The players' average, weighed the same way: the estimate's figure (par.json's par, what the results showed before
 * anyone played) as ESTIMATE_WEIGHT players, the real players' mean as n. No real players: the estimate's figure
 * exactly; no estimate: the real mean alone; neither: null.
 */
export function blendAverage(estimate: number | undefined, real: CrowdStats | null | undefined): number | null {
  const n = real?.n ?? 0;
  const mean = n && real?.avg != null ? real.avg : null;
  if (estimate === undefined) return mean;
  if (mean === null) return estimate;
  return (ESTIMATE_WEIGHT * estimate + n * mean) / (ESTIMATE_WEIGHT + n);
}

/** Where a score stands on the results. */
export interface Standing {
  /** The share of the blended players the score beats, 0-100 (game/par's percentile). */
  p: number;
  /** Real players counted. */
  n: number;
  /** True while the estimate outweighs the real players (n < ESTIMATE_WEIGHT): the line says "(estimated)". */
  estimated: boolean;
}

/**
 * Where a score (lists) or a 50-point bucket (Blitz) stands among the blended players, for the results line: "better
 * than 19% of players (estimated)" while n < ESTIMATE_WEIGHT, then "better than 12% of 1,203 players". Null when
 * there's nothing to stand on: no estimate and fewer than ESTIMATE_WEIGHT real players (Blitz has no estimate, so
 * its line starts at W players).
 */
export function standing(estimate: number[] | undefined, real: CrowdStats | null | undefined, bucket: number): Standing | null {
  const n = real?.n ?? 0;
  if (!(estimate && sum(estimate)) && n < ESTIMATE_WEIGHT) return null;
  return { p: percentile(blendCounts(estimate, real), bucket), n, estimated: n < ESTIMATE_WEIGHT };
}

export function blitzBucket(score: number): number {
  return Math.max(0, Math.min(MAX_BLITZ_BUCKET, Math.floor(score / BLITZ_BUCKET)));
}

/** Where a Blitz score stands. Blitz has no estimate: real players alone, from ESTIMATE_WEIGHT of them. */
export function blitzStanding(real: CrowdStats | null | undefined, score: number): Standing | null {
  return standing(undefined, real, blitzBucket(score));
}

/** "1,203" */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const count = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : null);

/**
 * The server's answer, checked: null for anything malformed. List counts always come back as 11 buckets; Blitz ones
 * as far as the top bucket anyone reached.
 */
export function parseStats(raw: unknown, mode: "list" | "blitz"): CrowdStats | null {
  const r = typeof raw === "string" ? safeJson(raw) : raw;
  if (typeof r !== "object" || r === null) return null;
  const o = r as Record<string, unknown>;
  const n = count(o.n);
  if (n === null || !Array.isArray(o.counts)) return null;
  const counts = o.counts.map(count);
  if (counts.some((c) => c === null)) return null;
  const size = mode === "list" ? 11 : Math.min(counts.length, MAX_BLITZ_BUCKET + 1);
  const fixed = Array.from({ length: size }, (_, i) => counts[i] ?? 0) as number[];
  const avg = typeof o.avg === "number" && Number.isFinite(o.avg) ? o.avg : typeof o.avg === "string" && o.avg !== "" && Number.isFinite(+o.avg) ? +o.avg : null;
  return { n, counts: fixed, avg };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Per-list averages (list_averages in the database), keyed by list id. */
export type ListAverages = Map<string, { n: number; avg: number }>;

export function parseAverages(raw: unknown): ListAverages {
  const out: ListAverages = new Map();
  if (!Array.isArray(raw)) return out;
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue;
    const { list_id, n, avg } = row as Record<string, unknown>;
    const a = typeof avg === "string" ? Number(avg) : avg;
    if (typeof list_id === "string" && count(n) !== null && typeof a === "number" && Number.isFinite(a)) {
      out.set(list_id, { n: n as number, avg: a });
    }
  }
  return out;
}

/**
 * Your list games against real players: for each list you've finished with at least MIN_PLAYERS players, your
 * average next to theirs. Lists come back by how many of your games they hold, then by name.
 */
export function compareWithPlayers(
  runs: { id: string; found: number[] }[],
  averages: ListAverages,
): { id: string; games: number; you: number; players: number; n: number }[] {
  const mine = new Map<string, number[]>();
  for (const r of runs) mine.set(r.id, [...(mine.get(r.id) ?? []), r.found.length]);
  const rows = [];
  for (const [id, scores] of mine) {
    const crowd = averages.get(id);
    if (!crowd || crowd.n < MIN_PLAYERS) continue;
    rows.push({ id, games: scores.length, you: scores.reduce((a, b) => a + b, 0) / scores.length, players: crowd.avg, n: crowd.n });
  }
  return rows.sort((a, b) => b.games - a.games || a.id.localeCompare(b.id));
}
