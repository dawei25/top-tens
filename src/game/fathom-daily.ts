/**
 * Today's Fathom (owner, Nov 14: "id like fathom to have a today's fathom"): every day the same ten questions for
 * everyone, one try, numbered from the first day ("Fathom #1"). The days are chosen ahead in a schedule file
 * (public/fathom/daily.json, written by scripts/fathom/daily.ts); a day the schedule hasn't reached gets a pick seeded by
 * its date, by the same rules, so every player still gets the same ten.
 *
 * The rules of a day's pick: a game's round mix and draw rules (`drawQuestions`: an easy number first, five estimates,
 * two percents, two years and a name-it round, kinds spread), and no question again until the bank has run out of them.
 * The script stops there and says so (`freshDay` is null); a seeded day in the game starts the bank over instead,
 * holding back the last few days, so a player always gets a game. Pure functions only; the script and the game share
 * them, so a scheduled day and a seeded one are the same pick for the same bank.
 */
import { drawQuestions, GAME_ROUNDS, QUESTIONS_PER_GAME, roundOf, type FathomQuestion } from "./fathom";
import type { FathomDay } from "./fathom-history";

/** One day of the schedule: its date, its number and its ten questions, in order. */
export interface FathomDailyEntry {
  n: number;
  date: string;
  ids: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The schedule file, as far as it can be trusted: well-formed days, sorted by date ([] when it isn't one). */
export function readSchedule(json: unknown): FathomDailyEntry[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (e): e is FathomDailyEntry =>
        !!e && typeof e === "object" && typeof e.date === "string" && DATE.test(e.date) && Number.isInteger(e.n) && e.n > 0 && Array.isArray(e.ids) && e.ids.length === QUESTIONS_PER_GAME && e.ids.every((id: unknown) => typeof id === "string"),
    )
    .map((e) => ({ n: e.n, date: e.date, ids: [...e.ids] }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** "2026-11-14" plus `days`, as a calendar date (no time zones: dates are the player's own). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string): number => {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
};

/** A random stream seeded by a date: the same date, the same numbers, on every device (mulberry32 of FNV-1a). */
export function seeded(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whether these questions are a whole game: the round mix of GAME_ROUNDS, an easy number question first. */
export function fullGame(qs: readonly FathomQuestion[]): boolean {
  if (qs.length !== GAME_ROUNDS.length || !qs[0]?.easy || roundOf(qs[0]) === "name") return false;
  const rounds = (rs: readonly string[]) => [...rs].sort().join();
  return rounds(qs.map(roundOf)) === rounds(GAME_ROUNDS);
}

/** The questions asked since the bank last started over, from the days before (oldest first). */
function askedThisCycle(before: readonly (readonly string[])[]): Set<string> {
  let asked = new Set<string>();
  for (const ids of before) {
    // A day that asks something already asked started the bank over.
    if (ids.some((id) => asked.has(id))) asked = new Set();
    for (const id of ids) asked.add(id);
  }
  return asked;
}

/**
 * A day's ten from the questions not asked since the bank last started over (the days before, oldest first), or null
 * once those don't make a whole game: the bank has run out.
 */
export function freshDay(bank: readonly FathomQuestion[], before: readonly (readonly string[])[], date: string): string[] | null {
  const asked = askedThisCycle(before);
  const fresh = drawQuestions(
    bank.filter((q) => !asked.has(q.id)),
    [],
    seeded(date),
  );
  return fullGame(fresh) ? fresh.map((q) => q.id) : null;
}

/**
 * A day's ten, given the days before it (oldest first): freshDay while the bank lasts; once it has run out, from the
 * whole bank again, the last few days held back (the game's seeded days: a player always gets a game).
 */
export function pickDay(bank: readonly FathomQuestion[], before: readonly (readonly string[])[], date: string): string[] {
  return freshDay(bank, before, date) ?? drawQuestions(bank, [...before].reverse(), seeded(date)).map((q) => q.id);
}

/** How far ahead a game works out seeded days past the schedule's end (a schedule that stopped long ago restarts). */
const MAX_SEEDED = 60;

/**
 * Which five a date's Fathom asks, and its number: the schedule's entry for that date, else the seeded pick (worked out
 * day by day from the schedule's end, so seeded days don't repeat each other), numbered on from the schedule (or from
 * `dayOne` when there is none). A scheduled day whose questions the bank lacks (a list that didn't load, a question
 * since dropped) is seeded instead, from the same bank for everyone.
 */
export function dayFor(
  schedule: readonly FathomDailyEntry[],
  bank: readonly FathomQuestion[],
  date: string,
  dayOne: string = schedule[0]?.date ?? date,
): FathomDay & { ids: string[] } {
  const have = new Set(bank.map((q) => q.id));
  const entry = schedule.find((e) => e.date === date);
  if (entry && entry.ids.every((id) => have.has(id))) return { date, n: entry.n, ids: entry.ids };
  const before = schedule.filter((e) => e.date < date);
  const days = before.map((e) => e.ids);
  const last = before[before.length - 1];
  let d = last ? addDays(last.date, 1) : date;
  if (daysBetween(d, date) > MAX_SEEDED) d = addDays(date, -MAX_SEEDED);
  for (; d < date; d = addDays(d, 1)) days.push(pickDay(bank, days, d));
  return { date, n: Math.max(1, daysBetween(dayOne, date) + 1), ids: pickDay(bank, days, date) };
}
