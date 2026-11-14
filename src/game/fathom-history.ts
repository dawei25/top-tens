/**
 * Fathom's part of the player's save (`Saved.fathom`, src/game/storage.ts), which travels with an account the way list
 * games do (src/net/sync/merge.ts merges it with mergeFathom): the finished games (Past runs), every finished game's
 * total (Stats), and the questions of the last few games drawn (held back from the next draw on every device). The game
 * on screen stays in this browser's own Fathom save (FATHOM_KEY in fathom.ts).
 *
 * Pure functions only, and nothing from Fathom's game code: Past runs, Stats and the sync are in the main bundle, the
 * game is its own chunk.
 */

/** Points a game can score: five questions of 100 (MAX_TOTAL in fathom.ts, which fathom.test.ts holds to this). */
export const FATHOM_MAX = 500;

/** The game on screen, in this browser only (loadFathom in fathom.ts reads it). */
export const FATHOM_KEY = "tentacle:fathom";

/** Settings' reset: the games under way (endless and today's) go with the rest of the progress. */
export function clearFathomGame(): void {
  try {
    localStorage.removeItem(FATHOM_KEY);
    localStorage.removeItem(FATHOM_DAILY_KEY);
  } catch {
    // No storage: nothing kept to clear.
  }
}

/** Games whose questions are held back from the next draw. */
export const HOLD_GAMES = 3;

/** How many finished games Past runs keeps (as list runs: MAX_LIST_RUNS). Stats count every game (`totals`). */
export const MAX_FATHOM_RUNS = 100;

export type Band = "dead-on" | "close" | "near" | "far" | "lost";

/** Bands by score, best first: the least score each one takes. */
export const BANDS: readonly { band: Band; label: string; min: number }[] = [
  { band: "dead-on", label: "Dead on", min: 90 },
  { band: "close", label: "Close", min: 70 },
  { band: "near", label: "Near", min: 40 },
  { band: "far", label: "Far", min: 15 },
  { band: "lost", label: "Lost at sea", min: 0 },
];

export function bandOf(score: number): Band {
  return (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]).band;
}

export const bandLabel = (band: Band): string => BANDS.find((b) => b.band === band)?.label ?? band;

/** A finished game, as Past runs keeps it: enough to show its results again. */
export interface FathomRun {
  /** Epoch ms: when it was drawn (the game's id) and when its last guess locked in. */
  startedAt: number;
  finishedAt: number;
  /** The five questions, by id, in order. */
  ids: string[];
  /** The guesses locked in, in order (a name-it round's is the figure of the thing named). */
  guesses: number[];
  /** What was named on a name-it round, by question id. */
  picks?: Record<string, string>;
  /** Each question's points as they were scored: the bank may change after. */
  points: number[];
  /** A day's Fathom: its date (the player's) and number ("Fathom #12"). Absent for an endless game. */
  daily?: FathomDay;
}

/** Which day's Fathom a game was: the date everyone played those five on, and its number. */
export interface FathomDay {
  date: string;
  n: number;
}

/** A game drawn (finished or not): its questions, held back from the next HOLD_GAMES draws. */
export interface FathomDraw {
  startedAt: number;
  ids: string[];
}

export interface FathomRecord {
  /** Finished games, newest first, at most MAX_FATHOM_RUNS. */
  runs?: FathomRun[];
  /** Every finished game's total, by its startedAt: what Stats count, never pruned (as firstTries for lists). */
  totals?: Record<string, number>;
  /** The last HOLD_GAMES games drawn, newest first. */
  recent?: FathomDraw[];
}

export const runTotal = (r: Pick<FathomRun, "points">): number => r.points.reduce((a, b) => a + b, 0);

/** The record with a finished game added (once: the same game, by startedAt, again changes nothing). */
export function recordRun(rec: FathomRecord | undefined, run: FathomRun): FathomRecord {
  const r = rec ?? {};
  const runs = r.runs ?? [];
  if (runs.some((x) => x.startedAt === run.startedAt) && r.totals?.[run.startedAt] !== undefined) return r;
  return {
    ...r,
    runs: sortRuns([run, ...runs.filter((x) => x.startedAt !== run.startedAt)]).slice(0, MAX_FATHOM_RUNS),
    totals: { ...r.totals, [run.startedAt]: runTotal(run) },
  };
}

/** The record with a game drawn: its questions held back from the next draws. */
export function noteDraw(rec: FathomRecord | undefined, draw: FathomDraw): FathomRecord {
  const r = rec ?? {};
  return { ...r, recent: mergeDraws(r.recent, [draw]) };
}

/** The question ids of the last games drawn, newest first (what the draw holds back). */
export const recentIds = (rec: FathomRecord | undefined): string[][] => (rec?.recent ?? []).map((d) => d.ids);

/** The finished game of a day's Fathom (one try a day: on any of the player's devices), if it was played. */
export const dailyRun = (rec: FathomRecord | undefined, date: string): FathomRun | undefined => rec?.runs?.find((r) => r.daily?.date === date);

/* ---------- Today's Fathom, under way on this device ---------- */

/** A day's game under way in this browser (finished, it is a run in the save): the day and the game's state. */
export interface DailyLocal {
  day: FathomDay;
  ids: string[];
  guesses: number[];
  at: number;
  picks?: Record<string, string>;
  startedAt: number;
}

export const FATHOM_DAILY_KEY = "tentacle:fathom-daily";

type Store = Pick<Storage, "getItem" | "setItem">;
const defaultStore = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

/** The day's game under way here, if any (junk and other shapes read as none). */
export function loadDailyLocal(store: Store | undefined = defaultStore()): DailyLocal | undefined {
  try {
    const x = JSON.parse(store?.getItem(FATHOM_DAILY_KEY) ?? "null") as Record<string, unknown> | null;
    if (!x || !isDay(x.day) || !isIds(x.ids) || !Array.isArray(x.guesses) || !x.guesses.every((g) => isNum(g) && g >= 0)) return undefined;
    if (!isNum(x.at) || !Number.isInteger(x.at) || !isNum(x.startedAt)) return undefined;
    const picks = isObj(x.picks) ? (Object.fromEntries(Object.entries(x.picks).filter(([, n]) => typeof n === "string")) as Record<string, string>) : undefined;
    return { day: x.day, ids: x.ids, guesses: x.guesses as number[], at: x.at, startedAt: x.startedAt, ...(picks && Object.keys(picks).length && { picks }) };
  } catch {
    return undefined;
  }
}

export function saveDailyLocal(game: DailyLocal, store: Store | undefined = defaultStore()): void {
  try {
    store?.setItem(FATHOM_DAILY_KEY, JSON.stringify(game));
  } catch {
    // Not kept: the day's game still plays, and its finished run is in the save.
  }
}

/** Today's Fathom as Home's key and the menu's tile show it: "new", "playing", or the score ("312/500"). */
export function fathomTodayStatus(rec: FathomRecord | undefined, date: string, local: DailyLocal | undefined = loadDailyLocal()): { status: string; done: boolean } {
  const run = dailyRun(rec, date);
  if (run) return { status: `${runTotal(run)}/${FATHOM_MAX}`, done: true };
  return { status: local?.day.date === date && local.guesses.length > 0 ? "playing" : "new", done: false };
}

/** One finished game, by its startedAt. */
export const findRun = (rec: FathomRecord | undefined, startedAt: number): FathomRun | undefined =>
  rec?.runs?.find((r) => r.startedAt === startedAt);

export interface FathomStats {
  played: number;
  /** The average total, out of FATHOM_MAX. */
  avg: number;
  best: number;
}

/** Games played, the average total and the best, over every finished game; null before the first. */
export function fathomStats(rec: FathomRecord | undefined): FathomStats | null {
  const totals = Object.values(rec?.totals ?? {});
  if (!totals.length) return null;
  return { played: totals.length, avg: totals.reduce((a, b) => a + b, 0) / totals.length, best: Math.max(...totals) };
}

/* ---------- Syncing (src/net/sync/merge.ts) ---------- */

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isIds = (x: unknown): x is string[] => Array.isArray(x) && x.every((id) => typeof id === "string");

function readRun(x: unknown): FathomRun | null {
  if (!isObj(x) || !isNum(x.startedAt) || !isNum(x.finishedAt) || !isIds(x.ids)) return null;
  if (!Array.isArray(x.guesses) || !x.guesses.every((g) => isNum(g) && g >= 0)) return null;
  if (!Array.isArray(x.points) || !x.points.every((p) => isNum(p) && p >= 0 && p <= 100) || x.points.length !== x.guesses.length) return null;
  const picks = isObj(x.picks) ? Object.fromEntries(Object.entries(x.picks).filter(([id, n]) => (x.ids as string[]).includes(id) && typeof n === "string")) : {};
  return {
    startedAt: x.startedAt,
    finishedAt: x.finishedAt,
    ids: x.ids,
    guesses: x.guesses as number[],
    ...(Object.keys(picks).length && { picks: picks as Record<string, string> }),
    points: x.points as number[],
    ...(isDay(x.daily) && { daily: { date: x.daily.date, n: x.daily.n } }),
  };
}

const isDay = (x: unknown): x is FathomDay =>
  isObj(x) && typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && isNum(x.n) && Number.isInteger(x.n) && x.n > 0;

/** Fathom's part of a save as it can be trusted (bad entries dropped), or undefined when there is none. */
export function sanitizeFathom(x: unknown): FathomRecord | undefined {
  if (!isObj(x)) return undefined;
  const out: FathomRecord = {};
  if (Array.isArray(x.runs)) out.runs = sortRuns(x.runs.map(readRun).filter((r): r is FathomRun => !!r)).slice(0, MAX_FATHOM_RUNS);
  if (isObj(x.totals))
    out.totals = Object.fromEntries(
      Object.entries(x.totals).filter((e): e is [string, number] => /^\d+$/.test(e[0]) && isNum(e[1]) && e[1] >= 0 && e[1] <= FATHOM_MAX),
    );
  if (Array.isArray(x.recent)) out.recent = mergeDraws(x.recent.filter((d): d is FathomDraw => isObj(d) && isNum(d.startedAt) && isIds(d.ids)), []);
  return out;
}

/** Newest finished first; a tie by start, so both devices sort alike. */
const sortRuns = (runs: FathomRun[]) => [...runs].sort((a, b) => b.finishedAt - a.finishedAt || b.startedAt - a.startedAt);

/** Draws from both sides, one per game (by startedAt), newest first, the last HOLD_GAMES. */
function mergeDraws(a: FathomDraw[] = [], b: FathomDraw[] = []): FathomDraw[] {
  const by = new Map<number, FathomDraw>();
  for (const d of [...a, ...b]) if (!by.has(d.startedAt)) by.set(d.startedAt, d);
  return [...by.values()].sort((x, y) => y.startedAt - x.startedAt).slice(0, HOLD_GAMES);
}

/**
 * Two devices' Fathom records as one: every finished game either has (one per startedAt: the same game on both is the
 * same game, the earlier finish kept), every total, and the last games drawn on either. Symmetric and idempotent, as the
 * rest of the merge.
 */
export function mergeFathom(a: FathomRecord | undefined, b: FathomRecord | undefined): FathomRecord | undefined {
  if (!a && !b) return undefined;
  const out: FathomRecord = {};
  if (a?.runs || b?.runs) {
    const by = new Map<number, FathomRun>();
    for (const r of [...(a?.runs ?? []), ...(b?.runs ?? [])]) {
      const o = by.get(r.startedAt);
      by.set(r.startedAt, !o || r.finishedAt < o.finishedAt || (r.finishedAt === o.finishedAt && JSON.stringify(r) < JSON.stringify(o)) ? r : o);
    }
    out.runs = sortRuns([...by.values()]).slice(0, MAX_FATHOM_RUNS);
  }
  if (a?.totals || b?.totals) {
    const totals: Record<string, number> = { ...b?.totals };
    // The same game on both sides has one total; a broken copy settles on the smaller, the same on every device.
    for (const [k, v] of Object.entries(a?.totals ?? {})) totals[k] = k in totals ? Math.min(v, totals[k]) : v;
    out.totals = totals;
  }
  if (a?.recent || b?.recent) out.recent = mergeDraws(a?.recent, b?.recent);
  return out;
}

/** The record without anything from before `t` (a reset made on another device, applied here). */
export function pruneFathom(rec: FathomRecord | undefined, t: number): FathomRecord | undefined {
  if (!rec) return undefined;
  const out: FathomRecord = {};
  if (rec.runs) out.runs = rec.runs.filter((r) => r.startedAt >= t);
  if (rec.totals) out.totals = Object.fromEntries(Object.entries(rec.totals).filter(([k]) => Number(k) >= t));
  if (rec.recent) out.recent = rec.recent.filter((d) => d.startedAt >= t);
  return out;
}
