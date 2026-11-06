// The by-category pickers on the real puzzle bank (public/puzzles). Launch audit, Nov 6: Science had one list; picked,
// then rolled again, it landed in Geography without a word. A category is offered only while a roll in it has at least
// MIN_CATEGORY_LISTS lists to land on, so Roll another list stays in it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DailyEntry } from "../game/daily";
import type { PuzzleMeta } from "../game/puzzles";
import type { Saved } from "../game/storage";
import { MIN_CATEGORY_LISTS, openBlitzLists, pickerCategories, rollableLists } from "./freeplay";

const dir = join(import.meta.dirname, "../../public/puzzles");
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(dir, f), "utf8"));
const index = read<PuzzleMeta[]>("index.json");
const schedule = read<DailyEntry[]>("daily.json");
const FRESH: Saved = { games: {}, daily: {}, seenHelp: true } as Saved;
const inCategory = (lists: PuzzleMeta[], c: string) => lists.filter((m) => m.category === c).length;

/** Every date of the schedule, a day before it and a day after it. */
const dates = (() => {
  const day = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const first = schedule[0].date;
  const last = schedule.at(-1)!.date;
  return [day(first, -1), ...schedule.map((e) => e.date), day(last, 1)];
})();

describe("by-category pickers on the real lists", () => {
  it.each(dates)("on %s every offered category has at least three lists a roll can land on", (today) => {
    const lists = rollableLists(schedule, index, FRESH, today);
    const blitz = openBlitzLists(schedule, index, FRESH, today);
    for (const [c] of pickerCategories(index, index, lists)) expect(inCategory(lists, c), `list: ${c}`).toBeGreaterThanOrEqual(MIN_CATEGORY_LISTS);
    for (const [c] of pickerCategories(index, blitz)) expect(inCategory(blitz, c), `Blitz: ${c}`).toBeGreaterThanOrEqual(MIN_CATEGORY_LISTS);
  });

  it("leaves a one-list category out of both pickers and keeps the big ones", () => {
    const today = schedule.at(-1)!.date;
    const lists = rollableLists(schedule, index, FRESH, today);
    const blitz = openBlitzLists(schedule, index, FRESH, today);
    const small = [...new Set(index.map((m) => m.category))].filter((c) => inCategory(index, c) < MIN_CATEGORY_LISTS);
    expect(small.length, "the bank has a category this small (Science, at the launch)").toBeGreaterThan(0);
    const offered = [...pickerCategories(index, index, lists), ...pickerCategories(index, blitz)].map(([c]) => c);
    for (const c of small) expect(offered).not.toContain(c);
    expect(pickerCategories(index, index, lists).map(([c]) => c)).toContain("Geography");
    expect(pickerCategories(index, blitz).map(([c]) => c)).toContain("Geography");
  });

  it("counts each category's lists in the given set, in the index's order", () => {
    const m = (id: string, category: string): PuzzleMeta => ({ id, title: id, category, blitz: true }) as PuzzleMeta;
    const all = [m("a", "X"), m("b", "Y"), m("c", "X"), m("d", "Y"), m("e", "X"), m("f", "Y"), m("g", "Z"), m("h", "Y")];
    expect(pickerCategories(all, all)).toEqual([["X", 3], ["Y", 4]]);
    // Counted on the full set, offered on what a roll can reach: Y keeps its count of 4 while 3 of them are open.
    expect(pickerCategories(all, all, all.filter((l) => l.id !== "b"))).toEqual([["X", 3], ["Y", 4]]);
    expect(pickerCategories(all, all, all.filter((l) => !["b", "d"].includes(l.id)))).toEqual([["X", 3]]);
  });
});
