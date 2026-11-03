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
   * Today's Blitz list. The schedule names one for every day, a different topic from the day's list; without one,
   * `blitzOfTheDay` falls back to a date-seeded pick on another list.
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

/**
 * Lists a random roll must not land on: today's daily (its save is today's result) and every future day's list and
 * Blitz (a roll shows the full list at the end, so it would spoil them).
 */
export function dailyHoldouts(schedule: DailyEntry[], today = localDate()): Set<string> {
  const ids = new Set(schedule.filter((e) => e.date > today).flatMap((e) => (e.blitz ? [e.id, e.blitz] : [e.id])));
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
 * Today's Blitz list, the same for everyone on a date. Today's list and Today's Blitz are separate topics: what makes
 * a good list (knowing the top 10 and its order) differs from what makes a good Blitz (lots of names that score).
 * - the schedule's own pick, if the entry names one (`scripts/schedule.ts` writes one for every day);
 * - otherwise (a day the schedule doesn't cover), a date-seeded pick among Blitz lists that isn't that date's daily
 *   (Blitz shows every answer, so it would spoil it) and isn't scheduled as a later daily.
 */
export function blitzOfTheDay(
  schedule: DailyEntry[],
  lists: { id: string; blitz?: boolean }[],
  date = localDate(),
): string | undefined {
  const entry = todayEntry(schedule, date);
  if (entry?.blitz && entry.date === date) return entry.blitz;
  const blocked = new Set(schedule.filter((e) => e.date >= date).map((e) => e.id));
  if (entry) blocked.add(entry.id);
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
 * Lists a random roll (list or Blitz) never lands on: today's list and Today's Blitz, played or not, and every future
 * day's list and Blitz (`dailyHoldouts`). Before the Blitz, a random list on its topic would show the full top 10 and
 * a free Blitz on it would be a practice run (Nov 3: a random list rolled the day's Blitz topic); after it, a roll on
 * it would replay answers just seen. They come back to random play the next day.
 */
export function rollHoldouts(
  schedule: DailyEntry[],
  lists: { id: string; blitz?: boolean }[],
  _saved?: Saved,
  today = localDate(),
): Set<string> {
  const ids = dailyHoldouts(schedule, today);
  const todays = blitzOfTheDay(schedule, lists, today);
  if (todays) ids.add(todays);
  return ids;
}

/** The holdouts for a free Blitz: the same as for any roll. */
export const blitzHoldouts = rollHoldouts;
