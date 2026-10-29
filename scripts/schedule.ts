// Extends the daily schedule (public/puzzles/daily.json) with the next N days, drawn from built puzzles that have
// never been a daily. Picks vary the category from day to day. The file is the record of what ran when.
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/schedule.ts <days> [--write]   (dry run without --write)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyEntry } from "../src/game/daily";
import { TOPICS } from "./topics";

const DIR = join(import.meta.dirname, "..", "public", "puzzles");
const FILE = join(DIR, "daily.json");

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function readSchedule(): DailyEntry[] {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
}

/** Topics that are built and have never been scheduled, in catalog order. */
export function bank(schedule: DailyEntry[]): { id: string; category: string }[] {
  const used = new Set(schedule.map((e) => e.id));
  return TOPICS.filter((t) => !used.has(t.id) && existsSync(join(DIR, `${t.id}.json`))).map((t) => ({
    id: t.id,
    category: t.category,
  }));
}

/** The next `days` entries after the last scheduled date (or starting today), rotating categories: each day takes
 * the category used longest ago, so a geography-heavy bank still alternates with sports, culture and the rest. */
export function nextEntries(schedule: DailyEntry[], days: number, today: string): DailyEntry[] {
  const pool = bank(schedule);
  const category = new Map(TOPICS.map((t) => [t.id, t.category]));
  const last = schedule.at(-1);
  let date = last && last.date >= today ? addDays(last.date, 1) : today;
  let n = (last?.n ?? 0) + 1;
  const lastUsed = new Map<string, number>();
  schedule.forEach((e, i) => lastUsed.set(category.get(e.id) ?? "", i));
  const out: DailyEntry[] = [];
  for (let i = 0; i < days && pool.length; i++) {
    const age = (c: string) => lastUsed.get(c) ?? -1;
    const oldest = Math.min(...pool.map((p) => age(p.category)));
    const [chosen] = pool.splice(pool.findIndex((p) => age(p.category) === oldest), 1);
    out.push({ n, date, id: chosen.id });
    lastUsed.set(chosen.category, schedule.length + i);
    date = addDays(date, 1);
    n++;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const days = Number(process.argv[2] ?? 7);
  const write = process.argv.includes("--write");
  const schedule = readSchedule();
  const today = new Date().toISOString().slice(0, 10);
  const next = nextEntries(schedule, days, today);
  for (const e of next) console.log(`#${e.n} ${e.date} ${e.id}`);
  console.log(`${bank(schedule).length - next.length} unscheduled puzzles left in the bank after this batch`);
  if (write) writeFileSync(FILE, JSON.stringify([...schedule, ...next], null, 1) + "\n");
  else console.log("(dry run: add --write to save)");
}
