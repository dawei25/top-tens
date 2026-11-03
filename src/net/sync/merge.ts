import { BLITZ_SECONDS, MAX_BLITZ_RUNS, blitzScore, type BlitzRun, type BlitzState } from "../../game/blitz";
import { localDate } from "../../game/daily";
import { MAX_LIST_RUNS, type ListRun } from "../../game/history";
import type { GameState } from "../../game/state";
import { withFirstTries, type DailyBlitzResult, type Saved } from "../../game/storage";

/**
 * Merging two copies of the save (this device's `top-tens:v1` and the account's copy on the server) into one that
 * keeps everything either side knows. Pure functions only: no storage, no clock (callers pass `now`).
 *
 * The rules, field by field:
 * - listRuns, blitzRuns: the union, one run per (list, startedAt), newest first, capped as the game caps them.
 * - firstTries (what stats count, per list and mode): each side first fills in what its own history implies, as
 *   loading a save does (a copy from an older build may not have them yet); then per list the earliest start wins.
 *   An existing first try is never replaced by a later one, so playing a list again on another device can't change
 *   its stats. The same game on both sides keeps the copy its history keeps (first finish; the fuller round).
 * - games (one per list): the same game (same startedAt) keeps its finished state over an in-progress one, and the
 *   further-along of two in-progress ones. Different games: the newer one; an older finished one is already in
 *   listRuns, so nothing is lost.
 * - dailyGames, blitzDaily: one try per date (locked), so the first try of that date wins on both devices: the first
 *   finished daily game, the Blitz round that started first.
 * - daily (streak days): the union. seenHelp: true if either side has it. blitzBest: the max.
 * - blitzLive (a round in progress per list): the newer round; the other one, if its time is up, becomes a run.
 * - resetAt: a reset made while signed in. Anything older than the newest reset is dropped from both sides, so a
 *   reset reaches every device instead of being merged back.
 * - Unknown fields (from a newer version of the game) are kept; where both sides have one, the server's value (this
 *   version can't have changed a field it doesn't know).
 *
 * The result never depends on which side is which: real ties fall back to comparing content. Otherwise two devices
 * that each kept their own side of a tie would rewrite the server's copy back and forth on every sync.
 */

export interface SyncSave extends Saved {
  /** When all progress was last reset while signed in (epoch ms). */
  resetAt?: number;
}

type Rec<T> = Record<string, T>;
type FirstTries = NonNullable<Saved["firstTries"]>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";

const isGame = (g: unknown): g is GameState =>
  isObj(g) && isStr(g.puzzleId) && Array.isArray(g.found) && isNum(g.lives) && Array.isArray(g.log) && isStr(g.status);
const isListRun = (r: unknown): r is ListRun =>
  isObj(r) && isStr(r.id) && isNum(r.startedAt) && isNum(r.finishedAt) && Array.isArray(r.found);
const isBlitzRun = (r: unknown): r is BlitzRun =>
  isObj(r) && isNum(r.startedAt) && isNum(r.endedAt) && isNum(r.score) && Array.isArray(r.hits);
const isBlitzState = (s: unknown): s is BlitzState => isObj(s) && isStr(s.puzzleId) && Array.isArray(s.hits) && isNum(s.startedAt);
const isDailyBlitz = (d: unknown): d is DailyBlitzResult => isObj(d) && isStr(d.id) && isNum(d.score) && isNum(d.answers);

function filterRec<T>(x: unknown, ok: (v: unknown, k: string) => v is T): Rec<T> {
  const out: Rec<T> = {};
  if (isObj(x)) for (const [k, v] of Object.entries(x)) if (ok(v, k)) out[k] = v;
  return out;
}

/** Copy `value` into `out[key]`, or leave the key out entirely when there's nothing (so merges don't invent fields). */
function setOpt<K extends keyof SyncSave>(out: SyncSave, key: K, value: SyncSave[K] | undefined) {
  if (value === undefined) delete out[key];
  else out[key] = value;
}

/**
 * A save as it can be trusted: known fields with the right shape (bad entries dropped), unknown fields as they are.
 * Anything that isn't an object reads as an empty save.
 */
export function sanitize(x: unknown): SyncSave {
  const s = isObj(x) ? x : {};
  const out = { ...s } as unknown as SyncSave;
  out.games = filterRec(s.games, isGame);
  out.daily = filterRec(s.daily, (v, k): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(k));
  out.seenHelp = s.seenHelp === true;
  setOpt(out, "blitzBest", isObj(s.blitzBest) ? filterRec(s.blitzBest, isNum) : undefined);
  setOpt(
    out,
    "blitzRuns",
    isObj(s.blitzRuns)
      ? Object.fromEntries(
          Object.entries(s.blitzRuns)
            .filter(([, runs]) => Array.isArray(runs))
            .map(([id, runs]) => [id, (runs as unknown[]).filter(isBlitzRun)]),
        )
      : undefined,
  );
  setOpt(out, "blitzDaily", isObj(s.blitzDaily) ? filterRec(s.blitzDaily, isDailyBlitz) : undefined);
  setOpt(out, "dailyGames", isObj(s.dailyGames) ? filterRec(s.dailyGames, isGame) : undefined);
  setOpt(out, "listRuns", Array.isArray(s.listRuns) ? s.listRuns.filter(isListRun) : undefined);
  setOpt(out, "blitzLive", isObj(s.blitzLive) ? filterRec(s.blitzLive, isBlitzState) : undefined);
  setOpt(out, "firstTries", isObj(s.firstTries) ? sanitizeFirstTries(s.firstTries) : undefined);
  setOpt(out, "resetAt", isNum(s.resetAt) && s.resetAt > 0 ? s.resetAt : undefined);
  return out;
}

function sanitizeFirstTries(f: Record<string, unknown>): FirstTries {
  const out: FirstTries = {};
  // A list's first try is filed under its own id.
  if (isObj(f.list)) out.list = filterRec(f.list, (v, k): v is ListRun => isListRun(v) && v.id === k);
  if (isObj(f.blitz)) out.blitz = filterRec(f.blitz, isBlitzRun);
  return out;
}

/** Union of two records; `pick(mine, theirs)` settles keys both have. */
function mergeRec<T>(a: Rec<T>, b: Rec<T>, pick: (mine: T, theirs: T) => T): Rec<T> {
  const out: Rec<T> = { ...b };
  for (const [k, v] of Object.entries(a)) out[k] = k in b ? pick(v, b[k]) : v;
  return out;
}

function mergeOptRec<T>(a: Rec<T> | undefined, b: Rec<T> | undefined, pick: (mine: T, theirs: T) => T): Rec<T> | undefined {
  return a || b ? mergeRec(a ?? {}, b ?? {}, pick) : undefined;
}

/** The last word on a real tie: whichever sorts first by content, so every device picks the same one. */
function tie<T>(x: T, y: T): T {
  return stableJson(y) < stableJson(x) ? y : x;
}

/** Prefer the side where `key` is smaller; a tie goes to content. */
function smaller<T>(x: T, y: T, key: (v: T) => number): T {
  const a = key(x);
  const b = key(y);
  return a === b ? tie(x, y) : b < a ? y : x;
}

/** Of two finished copies of a game, the one that finished first (one try: the first finish stands). */
function firstFinished(x: GameState, y: GameState): GameState {
  // A finished game without a timestamp is from an old build, so older than any with one.
  return smaller(x, y, (g) => g.finishedAt ?? 0);
}

/** A list's saved game, kept by both sides: see the rules at the top. */
export function pickGame(x: GameState, y: GameState): GameState {
  const a = x.startedAt ?? 0;
  const b = y.startedAt ?? 0;
  if (a !== b) return b > a ? y : x;
  const doneX = x.status !== "playing";
  const doneY = y.status !== "playing";
  if (doneX !== doneY) return doneY ? y : x;
  if (doneX) return firstFinished(x, y);
  return smaller(x, y, (g) => -g.log.length);
}

/** A date's Blitz: the round that started first (one round per date; old results without a start count as first). */
function firstDailyBlitz(x: DailyBlitzResult, y: DailyBlitzResult): DailyBlitzResult {
  return smaller(x, y, (d) => d.startedAt ?? -Infinity);
}

/** Two copies of the same finished round: the more complete one. */
function pickRun(x: BlitzRun, y: BlitzRun): BlitzRun {
  if (x.hits.length !== y.hits.length) return y.hits.length > x.hits.length ? y : x;
  return smaller(x, y, (r) => -r.score);
}

/** Two copies of the same list game in the history: the first finish. */
function pickListRun(x: ListRun, y: ListRun): ListRun {
  return smaller(x, y, (r) => r.finishedAt);
}

/** A list's first try on each side: the one that started first; the same game on both, as `same` keeps it. */
function earliest<T extends { startedAt: number }>(same: (x: T, y: T) => T) {
  return (x: T, y: T): T => (x.startedAt === y.startedAt ? same(x, y) : y.startedAt < x.startedAt ? y : x);
}

function mergeFirstTries(a: FirstTries | undefined, b: FirstTries | undefined): FirstTries | undefined {
  if (!a && !b) return undefined;
  const out: FirstTries = {};
  const list = mergeOptRec(a?.list, b?.list, earliest(pickListRun));
  const blitz = mergeOptRec(a?.blitz, b?.blitz, earliest(pickRun));
  if (list) out.list = list;
  if (blitz) out.blitz = blitz;
  return out;
}

function mergeRunList(a: BlitzRun[] = [], b: BlitzRun[] = []): BlitzRun[] {
  const by = new Map<number, BlitzRun>();
  for (const r of a) by.set(r.startedAt, by.has(r.startedAt) ? pickRun(by.get(r.startedAt)!, r) : r);
  for (const r of b) by.set(r.startedAt, by.has(r.startedAt) ? pickRun(by.get(r.startedAt)!, r) : r);
  return [...by.values()].sort((x, y) => y.startedAt - x.startedAt).slice(0, MAX_BLITZ_RUNS);
}

function mergeListRuns(a: ListRun[] | undefined, b: ListRun[] | undefined): ListRun[] | undefined {
  if (!a && !b) return undefined;
  const by = new Map<string, ListRun>();
  const add = (r: ListRun) => {
    const k = `${r.id}\n${r.startedAt}`;
    const o = by.get(k);
    // The same game finished on two devices (rare: it was synced mid-game): the first finish stands.
    by.set(k, o ? pickListRun(o, r) : r);
  };
  (a ?? []).forEach(add);
  (b ?? []).forEach(add);
  return [...by.values()]
    .sort((x, y) => y.finishedAt - x.finishedAt || y.startedAt - x.startedAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, MAX_LIST_RUNS);
}

/** A round in progress whose time is up, as the run it became; null while it could still be running somewhere. */
export function retireLive(s: BlitzState, now: number): BlitzRun | null {
  if (!s.startedAt) return null;
  const end = s.startedAt + BLITZ_SECONDS * 1000;
  if (now < end) return null;
  return { startedAt: s.startedAt, endedAt: Math.min(s.endedAt ?? end, end), score: blitzScore(s), hits: s.hits };
}

/**
 * Everything from before `t` dropped: a reset that happened on another device, applied here. Blitz bests are worked
 * out again from the rounds that are left.
 */
export function pruneBefore(save: SyncSave, t: number): SyncSave {
  const keep = (at: number | undefined) => at !== undefined && at >= t;
  const out: SyncSave = { ...save };
  out.games = filterRec(save.games, (g): g is GameState => isGame(g) && keep(g.startedAt));
  if (save.dailyGames) out.dailyGames = filterRec(save.dailyGames, (g): g is GameState => isGame(g) && keep(g.startedAt));
  // Streak days carry no time: a day stays if its daily was finished after the reset, or it's after the reset's day.
  const resetDay = localDate(new Date(t));
  out.daily = filterRec(save.daily, (v, date): v is string => isStr(v) && (!!out.dailyGames?.[date] || date > resetDay));
  if (save.listRuns) out.listRuns = save.listRuns.filter((r) => keep(r.startedAt));
  if (save.blitzRuns) {
    const runs: Rec<BlitzRun[]> = {};
    for (const [id, list] of Object.entries(save.blitzRuns)) {
      const left = list.filter((r) => keep(r.startedAt));
      if (left.length) runs[id] = left;
    }
    out.blitzRuns = runs;
  }
  if (save.blitzBest) {
    const best: Rec<number> = {};
    for (const [id, list] of Object.entries(out.blitzRuns ?? {})) best[id] = Math.max(...list.map((r) => r.score));
    out.blitzBest = best;
  }
  if (save.blitzDaily) out.blitzDaily = filterRec(save.blitzDaily, (d): d is DailyBlitzResult => isDailyBlitz(d) && keep(d.startedAt));
  if (save.blitzLive) out.blitzLive = filterRec(save.blitzLive, (l): l is BlitzState => isBlitzState(l) && keep(l.startedAt));
  if (save.firstTries) {
    // A list played again after the reset gets its new first try from what's left (see mergeSaves).
    const f: FirstTries = {};
    if (save.firstTries.list) f.list = filterRec(save.firstTries.list, (r): r is ListRun => isListRun(r) && keep(r.startedAt));
    if (save.firstTries.blitz) f.blitz = filterRec(save.firstTries.blitz, (r): r is BlitzRun => isBlitzRun(r) && keep(r.startedAt));
    out.firstTries = f;
  }
  return out;
}

/** The first tries a side's own history implies, filled in as loading a save does (existing ones stay). */
function withOwnFirstTries(save: SyncSave): SyncSave {
  return withFirstTries(save) as SyncSave;
}

/**
 * This device's save merged with the server's. Merging is idempotent (merging the result with either side again
 * changes nothing) and symmetric (which side is which only matters for fields this version doesn't know).
 */
export function mergeSaves(local: unknown, remote: unknown, now: number): SyncSave {
  let a = sanitize(local);
  let b = sanitize(remote);
  const resetAt = Math.max(a.resetAt ?? 0, b.resetAt ?? 0);
  if (resetAt) {
    a = pruneBefore(a, resetAt);
    b = pruneBefore(b, resetAt);
  }
  a = withOwnFirstTries(a);
  b = withOwnFirstTries(b);

  const out: SyncSave = {
    ...a,
    ...b,
    games: mergeRec(a.games, b.games, pickGame),
    daily: {},
    seenHelp: a.seenHelp || b.seenHelp,
  };
  setOpt(out, "dailyGames", mergeOptRec(a.dailyGames, b.dailyGames, firstFinished));
  // A date names one daily, so the sides only disagree in a broken save: go with the game that counts, else content.
  out.daily = { ...a.daily, ...b.daily };
  for (const [date, id] of Object.entries(a.daily)) {
    const other = b.daily[date];
    if (other !== undefined && other !== id) out.daily[date] = out.dailyGames?.[date]?.puzzleId ?? tie(id, other);
  }
  setOpt(out, "blitzDaily", mergeOptRec(a.blitzDaily, b.blitzDaily, firstDailyBlitz));
  setOpt(out, "listRuns", mergeListRuns(a.listRuns, b.listRuns));

  let best = mergeOptRec(a.blitzBest, b.blitzBest, Math.max);
  let runs: Rec<BlitzRun[]> | undefined;
  if (a.blitzRuns || b.blitzRuns) {
    runs = {};
    for (const id of new Set([...Object.keys(a.blitzRuns ?? {}), ...Object.keys(b.blitzRuns ?? {})])) {
      runs[id] = mergeRunList(a.blitzRuns?.[id], b.blitzRuns?.[id]);
    }
  }

  let live: Rec<BlitzState> | undefined;
  if (a.blitzLive || b.blitzLive) {
    live = {};
    for (const id of new Set([...Object.keys(a.blitzLive ?? {}), ...Object.keys(b.blitzLive ?? {})])) {
      const mine = a.blitzLive?.[id];
      const theirs = b.blitzLive?.[id];
      let keep = mine ?? theirs!;
      if (mine && theirs) {
        if (mine.startedAt === theirs.startedAt) keep = smaller(mine, theirs, (s) => -s.hits.length);
        else {
          keep = (theirs.startedAt ?? 0) > (mine.startedAt ?? 0) ? theirs : mine;
          const other = keep === mine ? theirs : mine;
          // Two rounds on one list: the older one is over by now (or still running on its own device, which will
          // record it), so it joins the history like a round left behind.
          const run = retireLive(other, now);
          if (run) {
            runs = { ...runs, [id]: mergeRunList(runs?.[id], [run]) };
            best = { ...best, [id]: Math.max(best?.[id] ?? run.score, run.score) };
          }
        }
      }
      // A round already in the history is finished, whatever an older copy says.
      if (!runs?.[id]?.some((r) => r.startedAt === keep.startedAt)) live[id] = keep;
    }
  }
  setOpt(out, "blitzBest", best);
  setOpt(out, "blitzRuns", runs);
  setOpt(out, "blitzLive", live);
  setOpt(out, "firstTries", mergeFirstTries(a.firstTries, b.firstTries));
  setOpt(out, "resetAt", resetAt || undefined);
  // A round retired above may be a list's first Blitz round: filled in like any other (existing first tries stay).
  return withOwnFirstTries(out);
}

/** JSON with sorted keys, so two saves with the same content compare equal whatever order they were built in. */
export function stableJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined ? "null" : stableJson(v))).join(",")}]`;
  if (isObj(x)) {
    return `{${Object.keys(x)
      .filter((k) => x[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(x[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x) ?? "null";
}

export function sameSave(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}
