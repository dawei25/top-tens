import type { GameState } from "./state";
import type { Saved } from "./storage";

/** One day of the daily schedule (public/puzzles/daily.json). The file is the record of what ran when. */
export interface DailyEntry {
  /** Daily number, 1-based: "TENtacle #12". */
  n: number;
  /** Local calendar date, YYYY-MM-DD. Everyone gets the same list on the same date, at their own midnight. */
  date: string;
  id: string;
  /**
   * The day's Blitz list, from when each day also had a Blitz (retired Nov 9: Blitz is free play only). Kept, but
   * nothing shows it as a daily: an old link to a date's Blitz opens that list's free Blitz (`blitzOfTheDay`), and a
   * new list first scheduled here joins free play on this day (`heldDebuts`).
   */
  blitz?: string;
}

const base = import.meta.env.BASE_URL;

export async function loadSchedule(): Promise<DailyEntry[]> {
  try {
    const res = await fetch(`${base}puzzles/daily.json`);
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

/** The player's local date as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

/**
 * Today's entry. If the schedule hasn't reached today (a batch is late), the latest earlier entry stands in,
 * so the home screen never breaks.
 */
export function todayEntry(schedule: DailyEntry[], today = localDate()): DailyEntry | undefined {
  let best: DailyEntry | undefined;
  for (const e of schedule) if (e.date <= today && (!best || e.date > best.date)) best = e;
  return best;
}

export function entryForDate(schedule: DailyEntry[], date: string): DailyEntry | undefined {
  return schedule.find((e) => e.date === date);
}

/** A list as the index (public/puzzles/index.json) describes it, as far as the dailies need. */
export interface ListMeta {
  id: string;
  /** Playable in Blitz. */
  blitz?: boolean;
  /** A new list that runs first as a daily (`debut` in scripts/topics.ts): see `heldDebuts`. */
  debut?: boolean;
}

/**
 * Lists past their debut wait on `date`: those that ran as Today's list on an earlier date, and those named as a day's
 * Blitz on that date or before (a day's Blitz is free play now, so a list first scheduled as one joins on its day).
 */
function debuted(schedule: DailyEntry[], date: string): Set<string> {
  const ids = new Set(schedule.filter((e) => e.date < date).map((e) => e.id));
  for (const e of schedule) if (e.blitz && e.date <= date) ids.add(e.blitz);
  return ids;
}

/**
 * New lists debut as dailies (owner): a list built with `debut` stays out of random play until its first day as
 * Today's list has run, a date before `today` in daily.json. The day after, it is in random play like any other. A
 * list the schedule names as a day's Blitz instead joins random play on that day (owner, Nov 9: no Today's Blitz). A
 * debut list that isn't scheduled yet, or is scheduled as Today's list for today or later, is held.
 */
export function heldDebuts(schedule: DailyEntry[], lists: ListMeta[], today = localDate()): Set<string> {
  const ran = debuted(schedule, today);
  return new Set(lists.filter((l) => l.debut && !ran.has(l.id)).map((l) => l.id));
}

/**
 * Lists a random roll must not land on: today's daily (its save is today's result) and every future day's list (a
 * roll shows the full list at the end, so it would spoil them). A day's `blitz` is not held: it's free play.
 */
export function dailyHoldouts(schedule: DailyEntry[], today = localDate()): Set<string> {
  const ids = new Set(schedule.filter((e) => e.date > today).map((e) => e.id));
  const current = todayEntry(schedule, today);
  if (current) ids.add(current.id);
  return ids;
}

/**
 * A daily's saved game: its locked result if it was finished, otherwise the list's own save (a game in progress, or
 * a result from before dailies were locked).
 */
export function dailyGame(saved: Saved, entry: Pick<DailyEntry, "date" | "id">): GameState | undefined {
  return saved.dailyGames?.[entry.date] ?? saved.games[entry.id];
}

/** Dailies are one try each: the first finished game for a date stays its result. */
export function lockDaily(saved: Saved, date: string, game: GameState): Saved {
  if (game.status === "playing" || saved.dailyGames?.[date]) return saved;
  return { ...saved, dailyGames: { ...saved.dailyGames, [date]: game } };
}

/** Past and present dailies, newest first: the archive. Future entries are never listed. */
export function archive(schedule: DailyEntry[], today = localDate()): DailyEntry[] {
  return schedule.filter((e) => e.date <= today).sort((a, b) => b.date.localeCompare(a.date));
}

/** Milliseconds until the player's next local midnight, when the next daily unlocks. */
export function msUntilNextDaily(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** "05:12:09" */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export interface Streak {
  /** Consecutive days with the daily finished, ending today, or yesterday if today isn't played yet. */
  current: number;
  best: number;
  /** Total dailies finished on their own day. */
  played: number;
}

/**
 * Streaks count days the daily was finished (any score, including giving up) on its own date.
 * Playing an old daily from the archive doesn't count toward a streak.
 */
export function streak(saved: Saved, today = localDate()): Streak {
  const days = new Set(Object.keys(saved.daily).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  let current = 0;
  let day = days.has(today) ? today : addDays(today, -1);
  while (days.has(day)) {
    current++;
    day = addDays(day, -1);
  }
  let best = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue; // count each run once, from its first day
    let run = 0;
    for (let x = d; days.has(x); x = addDays(x, 1)) run++;
    best = Math.max(best, run);
  }
  return { current, best: Math.max(best, current), played: days.size };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A date's Blitz list, the same for everyone, from when each day also had a Blitz (retired Nov 9). Only an old link
 * to a date's Blitz (#dailyblitz-<date>) still asks, and opens this list's free Blitz.
 * - the schedule's own pick, if the entry names one (`scripts/schedule.ts` writes one for every day);
 * - otherwise (a day the schedule doesn't cover), a date-seeded pick among Blitz lists that isn't that date's daily
 *   (Blitz shows every answer, so it would spoil it), isn't scheduled as a later daily, and isn't a new list waiting
 *   for its debut on that date (`heldDebuts`: the pick for a date never changes when it debuts later).
 */
export function blitzOfTheDay(schedule: DailyEntry[], lists: ListMeta[], date = localDate()): string | undefined {
  const entry = todayEntry(schedule, date);
  if (entry?.blitz && entry.date === date) return entry.blitz;
  const blocked = new Set(schedule.filter((e) => e.date >= date).map((e) => e.id));
  if (entry) blocked.add(entry.id);
  for (const id of heldDebuts(schedule, lists, date)) blocked.add(id);
  const pool = lists.filter((l) => l.blitz && !blocked.has(l.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (!pool.length) return undefined;
  return pool[hash(`blitz:${date}`) % pool.length].id;
}

/**
 * The daily that a date's Blitz on list `id` would spoil: that date's daily (or the entry standing in for it) when
 * it is the same list and the player hasn't finished it. While it holds, that Blitz shows only what the player hit;
 * the rest shows once the daily is finished.
 */
export function blitzHold(schedule: DailyEntry[], date: string, id: string, saved: Saved): DailyEntry | undefined {
  const entry = entryForDate(schedule, date) ?? todayEntry(schedule, date);
  if (!entry || entry.id !== id) return undefined;
  const g = dailyGame(saved, entry);
  return !g || g.status === "playing" ? entry : undefined;
}

/**
 * Lists a random roll (list or Blitz) never lands on: today's list, played or not, and every future day's list
 * (`dailyHoldouts`). Today's list comes back to random play the next day. New lists wait for their debut as a daily
 * (`heldDebuts`), scheduled or not. A day's Blitz is held no more: since Nov 9 there is no Today's Blitz to spoil.
 */
export function rollHoldouts(schedule: DailyEntry[], lists: ListMeta[], _saved?: Saved, today = localDate()): Set<string> {
  const ids = dailyHoldouts(schedule, today);
  for (const id of heldDebuts(schedule, lists, today)) ids.add(id);
  return ids;
}

/** The holdouts for a free Blitz: the same as for any roll. */
export const blitzHoldouts = rollHoldouts;

/**
 * Saves from before dailies were locked keep a date's result only in the list's own game. Lock each such result to
 * its date (once), so replaying the list later never changes what the archive shows for that day.
 */
export function lockLegacyDailies(saved: Saved, schedule: DailyEntry[], today = localDate()): Saved {
  let dailyGames = saved.dailyGames;
  for (const e of schedule) {
    if (e.date > today || dailyGames?.[e.date]) continue;
    const g = saved.games[e.id];
    if (!g || g.status === "playing") continue;
    dailyGames = { ...dailyGames, [e.date]: g };
  }
  return dailyGames === saved.dailyGames ? saved : { ...saved, dailyGames };
}
