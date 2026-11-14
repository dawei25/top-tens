// Today's Fathom's schedule: public/fathom/daily.json, the same five questions for everyone each day, chosen ahead.
//   NODE_NO_WARNINGS=1 npx tsx scripts/fathom/daily.ts [--days 60] [--today YYYY-MM-DD] [--start YYYY-MM-DD]
// Today and tomorrow never change once written (players may have played them); the days after tomorrow are chosen
// again on every run, so a changed bank (questions.json, the lists) reaches them. Fails loudly when a day that can't
// change asks a question the bank no longer has. `--start` names day one (Fathom #1) for a new schedule; by default
// it is today. The picks are src/game/fathom-daily.ts's, which the game also uses for a day past the schedule's end.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, pickDay, readSchedule, type FathomDailyEntry } from "../../src/game/fathom-daily";
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

/**
 * The schedule from `today` to `days` days on: the days up to tomorrow as they are (past days and the two that may be
 * under way somewhere), the rest chosen again. Throws when today or tomorrow asks a question `bank` lacks; a past day
 * that does is only reported (it was played; its results keep their points).
 */
export function planSchedule(
  existing: readonly FathomDailyEntry[],
  bank: readonly FathomQuestion[],
  { today, days = 60, start = today }: { today: string; days?: number; start?: string },
): { schedule: FathomDailyEntry[]; warnings: string[] } {
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
  const end = addDays(today, days);
  for (; date <= end; date = addDays(date, 1), n++) schedule.push({ n, date, ids: pickDay(bank, schedule.map((e) => e.ids), date) });
  return { schedule, warnings };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const today = arg("today") ?? localDate();
  const { schedule, warnings } = planSchedule(loadSchedule(), loadBank(), { today, days: Number(arg("days") ?? 60), start: arg("start") ?? today });
  for (const w of warnings) console.warn(`warning: ${w}`);
  writeFileSync(SCHEDULE, JSON.stringify(schedule, null, 1) + "\n");
  console.log(`${SCHEDULE}: ${schedule.length} days, Fathom #${schedule[0]?.n} (${schedule[0]?.date}) to #${schedule.at(-1)?.n} (${schedule.at(-1)?.date})`);
}
