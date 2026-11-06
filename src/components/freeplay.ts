// Free play's choices right now: the lists a random roll can land on, the lists open for a free Blitz, and the
// categories Home's by-category pickers offer. App rolls from these; Home draws its keys and pickers from them.
import { blitzAvailable } from "../game/blitz";
import { blitzHoldouts, rollHoldouts, type DailyEntry } from "../game/daily";
import type { PuzzleMeta } from "../game/puzzles";
import type { Saved } from "../game/storage";

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
 * it can land on): with fewer, Roll another list would run out and widen to every list, and the player who picked
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
