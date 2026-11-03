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

/** A list's real numbers replace the estimate once this many players have finished it. */
export const MIN_PLAYERS = 50;
/** Blitz scores are counted in buckets this many points wide. */
export const BLITZ_BUCKET = 50;
const MAX_BLITZ_BUCKET = 100;

export function realEnough(s: CrowdStats | null | undefined): s is CrowdStats {
  return !!s && s.n >= MIN_PLAYERS;
}

/** The distribution to draw: the real one once enough players have finished the list, otherwise the estimate. */
export function pickCounts(estimate: number[], real: CrowdStats | null | undefined): { counts: number[]; real: CrowdStats | null } {
  return realEnough(real) ? { counts: real.counts, real } : { counts: estimate, real: null };
}

export function blitzBucket(score: number): number {
  return Math.max(0, Math.min(MAX_BLITZ_BUCKET, Math.floor(score / BLITZ_BUCKET)));
}

/** Where a Blitz score stands among real players (0-100), or null below MIN_PLAYERS. */
export function blitzPercentile(real: CrowdStats | null | undefined, score: number): number | null {
  return realEnough(real) ? percentile(real.counts, blitzBucket(score)) : null;
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
