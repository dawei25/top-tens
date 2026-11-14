// Free play's choices right now: the lists a random roll can land on, the lists open for a free Blitz, and the
// categories Home's by-category pickers offer. App rolls from these; Home draws its keys and pickers from them.
import { blitzAvailable } from "../game/blitz";
import { blitzHoldouts, rollHoldouts, type DailyEntry } from "../game/daily";
import { freeStartKey } from "../game/free-games";
import type { PuzzleMeta } from "../game/puzzles";
import type { Saved } from "../game/storage";

/**
 * localStorage: the marks free play leaves on the list games it starts (`<list id>:<startedAt>`, newest last), so the
 * free-play counter (src/game/free-games.ts) can tell a free game under way from a daily's on the same list (they share
 * the list's save). A mark only ever qualifies a game still in the save, so old marks are harmless; the newest 100 are
 * kept. Outside the save: it isn't synced (signed in, free play never runs out).
 */
export const FREE_STARTS_KEY = "top-tens:free-starts";
const MAX_FREE_STARTS = 100;

function readStarts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FREE_STARTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The marks, as the counter takes them. */
export const freeStarts = (): Set<string> => new Set(readStarts());

/** Free play started a new list game on `id` (a roll, Play again or a link): mark it. */
export function markFreeStart(id: string, startedAt: number): void {
  const key = freeStartKey(id, startedAt);
  const marks = readStarts().filter((k) => k !== key);
  try {
    localStorage.setItem(FREE_STARTS_KEY, JSON.stringify([...marks, key].slice(-MAX_FREE_STARTS)));
  } catch {
    // Storage blocked: nothing is remembered anyway.
  }
}

/** The fewest lists a roll in a category must have to land on for the pickers to offer it. */
export const MIN_CATEGORY_LISTS = 3;

/** The lists a random list can land on: never today's list or Blitz, a future day's, or a debut waiting for its day. */
export function rollableLists(schedule: DailyEntry[], index: PuzzleMeta[], saved: Saved, today: string): PuzzleMeta[] {
  const held = rollHoldouts(schedule, index, saved, today);
  return index.filter((m) => !held.has(m.id));
}

/** The lists open for a free Blitz (Home's counts and the Blitz roll use the same filter): the same holdouts. */
export function openBlitzLists(schedule: DailyEntry[], index: PuzzleMeta[], saved: Saved, today: string): PuzzleMeta[] {
  const held = blitzHoldouts(schedule, index, saved, today);
  return index.filter((m) => m.blitz && !held.has(m.id) && blitzAvailable({ id: m.id, blitz: true }, schedule, today, saved));
}

/**
 * A picker's categories, in one order for both pickers (the order categories first appear in the full index), each
 * with how many of `counted` it has. Only those with at least MIN_CATEGORY_LISTS lists in `rollable` (what a roll in
 * it can land on): with fewer, Roll new list would run out and widen to every list, and the player who picked
 * Science would land in Geography without a word (launch audit, Nov 6). A small category waits until it grows.
 */
export function pickerCategories(index: PuzzleMeta[], counted: PuzzleMeta[], rollable: PuzzleMeta[] = counted): [string, number][] {
  const tally = (lists: PuzzleMeta[]) => {
    const n = new Map<string, number>();
    for (const m of lists) n.set(m.category, (n.get(m.category) ?? 0) + 1);
    return n;
  };
  const counts = tally(counted);
  const open = tally(rollable);
  return [...new Set(index.map((m) => m.category))].flatMap((c) =>
    counts.has(c) && (open.get(c) ?? 0) >= MIN_CATEGORY_LISTS ? [[c, counts.get(c)!] as [string, number]] : [],
  );
}
