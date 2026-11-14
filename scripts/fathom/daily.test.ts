// Today's Fathom's schedule (public/fathom/daily.json) and the script that writes it (owner, Nov 14: "id like fathom to
// have a today's fathom"): the same five for everyone each day, a game's round mix, no question again until the bank
// runs out, today and tomorrow never changed once written, and a loud failure when a fixed day asks a question the bank
// no longer has.
import { describe, expect, it } from "vitest";
import { addDays, dayFor, fullGame, pickDay, readSchedule, type FathomDailyEntry } from "../../src/game/fathom-daily";
import type { FathomQuestion } from "../../src/game/fathom";
import { loadBank, loadSchedule, planSchedule } from "./daily";

const bank = loadBank();
const byId = new Map(bank.map((q) => [q.id, q]));
const schedule = loadSchedule();
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

describe("the committed schedule (public/fathom/daily.json)", () => {
  it("runs day by day from Fathom #1, at least a few weeks ahead", () => {
    expect(schedule.length).toBeGreaterThan(14);
    schedule.forEach((e, i) => {
      expect(e.n, e.date).toBe(i + 1);
      if (i) expect(e.date).toBe(addDays(schedule[i - 1].date, 1));
    });
    expect(schedule[schedule.length - 1].date >= addDays(TODAY, 7), "a week ahead at least: rerun the script").toBe(true);
  });

  // questions.json changes under it: a day from today on that asks a question the bank lacks fails here, loudly.
  it("asks, from today on, only questions the bank has", () => {
    const missing = schedule.filter((e) => e.date >= TODAY).flatMap((e) => e.ids.filter((id) => !byId.has(id)).map((id) => `#${e.n} ${e.date}: ${id}`));
    expect(missing).toEqual([]);
  });

  it("gives every day a whole game: an easy number first, two estimates, a percent, a year, a name-it round", () => {
    for (const e of schedule.filter((x) => x.date >= TODAY)) expect(fullGame(e.ids.map((id) => byId.get(id)!)), `#${e.n}`).toBe(true);
  });

  it("asks no question twice until the bank has run out of them", () => {
    const seen = new Set<string>();
    for (const e of schedule) {
      if (e.ids.some((id) => seen.has(id))) {
        // Only once the unasked questions can't make a whole game: the bank started over.
        const left = bank.filter((q) => !seen.has(q.id));
        expect(fullGame(pickDay(left, [], e.date).map((id) => byId.get(id)!)), `#${e.n} repeats while the bank has more`).toBe(false);
        seen.clear();
      }
      e.ids.forEach((id) => seen.add(id));
    }
  });

  it("is what the game works out for a scheduled day, and the next day past its end is the script's next pick", () => {
    for (const e of schedule.slice(0, 5)) expect(dayFor(schedule, bank, e.date)).toEqual({ date: e.date, n: e.n, ids: e.ids });
    const last = schedule[schedule.length - 1];
    const next = addDays(last.date, 1);
    const { schedule: longer } = planSchedule(schedule, bank, { today: addDays(last.date, -1), days: 2 });
    expect(dayFor(schedule, bank, next)).toEqual(longer.find((e) => e.date === next));
  });
});

describe("planSchedule", () => {
  const today = "2026-12-01";
  const base = planSchedule([], bank, { today, days: 10 }).schedule;

  it("starts at day one, Fathom #1, and runs `days` ahead", () => {
    expect(base[0]).toMatchObject({ n: 1, date: today });
    expect(base.at(-1)!.date).toBe(addDays(today, 10));
    expect(planSchedule([], bank, { today, days: 3, start: "2026-11-28" }).schedule[0]).toMatchObject({ n: 1, date: "2026-11-28" });
  });

  it("keeps today and tomorrow as written when the bank changes; the days after are chosen again", () => {
    // A bank without the question tomorrow's day doesn't ask, but the day after does.
    const later = base[3].ids.find((id) => !base[1].ids.includes(id) && !base[2].ids.includes(id))!;
    const smaller = bank.filter((q) => q.id !== later);
    const again = planSchedule(base, smaller, { today: addDays(today, 1), days: 10 }).schedule;
    expect(again.slice(0, 3)).toEqual(base.slice(0, 3));
    expect(again.flatMap((e) => e.ids)).not.toContain(later);
  });

  it("fails loudly when today or tomorrow asks a question the bank no longer has; a past day is only reported", () => {
    const gone = base[2].ids[1];
    const without = bank.filter((q) => q.id !== gone);
    expect(() => planSchedule(base, without, { today: addDays(today, 1), days: 5 })).toThrow(new RegExp(`${gone}.*can't change`));
    const { warnings } = planSchedule(base, without, { today: addDays(today, 4), days: 5 });
    expect(warnings.join()).toContain(gone);
  });

  it("reads only well-formed days", () => {
    const bad = [{ n: 1, date: "2026-12-01", ids: ["a"] }, { n: 2, date: "Dec 2", ids: ["a", "b", "c", "d", "e"] }, null, { n: 3, date: "2026-12-03", ids: ["a", "b", "c", "d", "e"] }];
    expect(readSchedule(bad)).toEqual([{ n: 3, date: "2026-12-03", ids: ["a", "b", "c", "d", "e"] }] satisfies FathomDailyEntry[]);
    expect(readSchedule("<!doctype html>")).toEqual([]);
  });
});

describe("dayFor (the game's side)", () => {
  const two = planSchedule([], bank, { today: "2026-12-01", days: 1 }).schedule;
  it("numbers seeded days on from the schedule, the same five for everyone, none of the days before", () => {
    const a = dayFor(two, bank, "2026-12-05");
    expect(a.n).toBe(5);
    expect(dayFor(two, bank, "2026-12-05")).toEqual(a);
    const asked = new Set([...two.flatMap((e) => e.ids), ...dayFor(two, bank, "2026-12-03").ids, ...dayFor(two, bank, "2026-12-04").ids]);
    expect(a.ids.filter((id) => asked.has(id))).toEqual([]);
    expect(fullGame(a.ids.map((id) => byId.get(id)!))).toBe(true);
  });
  it("seeds a scheduled day whose questions the bank lacks, the same way for everyone", () => {
    const gone = two[0].ids[0];
    const without: FathomQuestion[] = bank.filter((q) => q.id !== gone);
    const d = dayFor(two, without, two[0].date);
    expect(d.n).toBe(1);
    expect(d.ids).not.toContain(gone);
    expect(dayFor(two, without, two[0].date)).toEqual(d);
  });
});
