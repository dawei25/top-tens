// Today's Fathom's schedule: public/fathom/daily.json, the same ten questions for everyone each day, chosen ahead.
//   NODE_NO_WARNINGS=1 npx tsx scripts/fathom/daily.ts [--days 14] [--today YYYY-MM-DD] [--start YYYY-MM-DD] [--repeat]
// Today and tomorrow never change once written (players may have played them); the days after tomorrow are chosen
// again on every run, so a changed bank (questions.json, the lists) reaches them. It always says how many days the
// bank covers with questions not asked yet. It fails loudly, writing nothing, when a day that can't change asks a
// question the bank no longer has, and when the bank runs out before the days asked for (ten a day uses it fast):
// add questions, ask for fewer days, or pass --repeat to let the bank start over (the last few days held back).
// `--start` names day one (Fathom #1) for a new schedule; by default it is today. The picks are
// src/game/fathom-daily.ts's, which the game also uses for a day past the schedule's end.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, daysBetween, freshDay, pickDay, readSchedule, type FathomDailyEntry } from "../../src/game/fathom-daily";
import type { FathomQuestion } from "../../src/game/fathom";
import { nameListIds, readFullBank, readList, type NameList } from "../../src/game/fathom-name";

const ROOT = join(import.meta.dirname, "..", "..");
export const SCHEDULE = join(ROOT, "public", "fathom", "daily.json");
const QUESTIONS = join(ROOT, "public", "fathom", "questions.json");
const LISTS = join(ROOT, "public", "fathom", "lists");

/** The bank as the game reads it: the number questions and the name-it questions whose lists are there. */
export function loadBank(): FathomQuestion[] {
  const json = JSON.parse(readFileSync(QUESTIONS, "utf8"));
  const lists = new Map<string, NameList>();
  for (const id of nameListIds(json)) {
    const list = readList(JSON.parse(readFileSync(join(LISTS, `${id}.json`), "utf8")));
    if (list) lists.set(id, list);
  }
  return readFullBank(json, lists)!;
}

export function loadSchedule(): FathomDailyEntry[] {
  try {
    return readSchedule(JSON.parse(readFileSync(SCHEDULE, "utf8")));
  } catch {
    return [];
  }
}

/** The local date, YYYY-MM-DD. */
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The bank has run out of questions not asked yet before the last day asked for. */
export class BankRanOut extends Error {}

/** How many days after `before` (oldest first), from `date` on, the bank fills with questions not asked yet. */
export function daysCovered(bank: readonly FathomQuestion[], before: readonly (readonly string[])[], date: string, most = 366): number {
  const days = before.map((ids) => [...ids]);
  let n = 0;
  for (let d = date; n < most; d = addDays(d, 1), n++) {
    const ids = freshDay(bank, days, d);
    if (!ids) break;
    days.push(ids);
  }
  return n;
}

/**
 * The schedule from `today` to `days` days on: the days up to tomorrow as they are (past days and the two that may be
 * under way somewhere), the rest chosen again, each from questions not asked yet. `covers`: how many days from today
 * the bank fills that way (the fixed days included). Throws when today or tomorrow asks a question `bank` lacks (a
 * past day that does is only reported: it was played, its results keep their points), and BankRanOut when the bank
 * can't fill the days asked for, unless `repeat` lets it start over.
 */
export function planSchedule(
  existing: readonly FathomDailyEntry[],
  bank: readonly FathomQuestion[],
  { today, days = 14, start = today, repeat = false }: { today: string; days?: number; start?: string; repeat?: boolean },
): { schedule: FathomDailyEntry[]; warnings: string[]; covers: number } {
  const have = new Set(bank.map((q) => q.id));
  const tomorrow = addDays(today, 1);
  const kept = existing.filter((e) => e.date <= tomorrow);
  const warnings: string[] = [];
  for (const e of kept) {
    const missing = e.ids.filter((id) => !have.has(id));
    if (!missing.length) continue;
    const line = `Fathom #${e.n} (${e.date}) asks ${missing.join(", ")}, not in the bank`;
    if (e.date >= today) throw new Error(`${line}: today and tomorrow can't change. Put the question back, or rewrite that day by hand.`);
    warnings.push(line);
  }
  const schedule = [...kept];
  const last = schedule[schedule.length - 1];
  let date = last ? addDays(last.date, 1) : start;
  let n = last ? last.n + 1 : 1;
  // From today: the fixed days still ahead, then as many as fresh questions fill.
  const covers = Math.max(0, daysBetween(today, date)) + daysCovered(bank, schedule.map((e) => e.ids), date);
  const end = addDays(today, days);
  for (; date <= end; date = addDays(date, 1), n++) {
    const before = schedule.map((e) => e.ids);
    const ids = repeat ? pickDay(bank, before, date) : freshDay(bank, before, date);
    if (!ids) {
      throw new BankRanOut(
        `The bank runs out on ${date} (Fathom #${n}): ${bank.length} questions cover ${covers} days from ${today}, ` +
          `through ${addDays(today, covers - 1)}, and ${days + 1} were asked for. Add questions, ask for fewer days ` +
          `(--days ${Math.max(0, covers - 1)}), or pass --repeat to let the bank start over.`,
      );
    }
    schedule.push({ n, date, ids });
  }
  return { schedule, warnings, covers };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const today = arg("today") ?? localDate();
  try {
    const { schedule, warnings, covers } = planSchedule(loadSchedule(), loadBank(), {
      today,
      days: Number(arg("days") ?? 14),
      start: arg("start") ?? today,
      repeat: process.argv.includes("--repeat"),
    });
    for (const w of warnings) console.warn(`warning: ${w}`);
    writeFileSync(SCHEDULE, JSON.stringify(schedule, null, 1) + "\n");
    console.log(`${SCHEDULE}: ${schedule.length} days, Fathom #${schedule[0]?.n} (${schedule[0]?.date}) to #${schedule.at(-1)?.n} (${schedule.at(-1)?.date})`);
    console.log(`The bank covers ${covers} days from ${today} with questions not asked yet (through ${addDays(today, covers - 1)}).`);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}
