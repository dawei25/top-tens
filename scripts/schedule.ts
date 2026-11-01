// Extends the daily schedule (public/puzzles/daily.json) with the next N days. Only lists the list judge approved
// can run (docs/JUDGE.md, verdicts in scripts/judge/verdicts/): `daily-list` verdicts on Blitz-ready lists, highest
// priority first, rotating categories. Each day is one topic, played as both Today's list and Today's Blitz (new
// entries carry no `blitz` field; older entries with one keep their separate Blitz). The file is the record of what
// ran when.
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/schedule.ts <days> [--write]   (dry run without --write)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

export interface Verdict {
  id: string;
  decision: "daily-list" | "daily-blitz" | "free-play" | "fix-first" | "reject";
  alsoBlitz?: boolean;
  priority: number;
  summary: string;
  scores?: { blitzDepth?: number };
}

const VERDICTS = join(import.meta.dirname, "judge", "verdicts");

export function readVerdicts(): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  if (!existsSync(VERDICTS)) return out;
  for (const f of readdirSync(VERDICTS)) {
    if (!f.endsWith(".json")) continue;
    const v: Verdict = JSON.parse(readFileSync(join(VERDICTS, f), "utf8"));
    out.set(v.id, v);
  }
  return out;
}

const listOk = (v?: Verdict) => v?.decision === "daily-list" && (v.scores?.blitzDepth ?? 0) >= 3;
/** The day's list is also its Blitz, so it has to be Blitz-ready. */
const blitzReady = (id: string) => JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8")).blitz === true;

/** Built topics the judge approved for Today's list and that have never been a daily. */
export function bank(schedule: DailyEntry[], verdicts = readVerdicts()): { id: string; category: string }[] {
  // A list that already ran as a Blitz isn't a fresh daily either.
  const used = new Set(schedule.flatMap((e) => (e.blitz ? [e.id, e.blitz] : [e.id])));
  return TOPICS.filter((t) => !used.has(t.id) && existsSync(join(DIR, `${t.id}.json`)) && listOk(verdicts.get(t.id)) && blitzReady(t.id)).map(
    (t) => ({ id: t.id, category: t.category }),
  );
}

/** The next `days` entries after the last scheduled date (or starting today): the category used longest ago, then the
 * judge's highest priority. */
export function nextEntries(schedule: DailyEntry[], days: number, today: string, verdicts = readVerdicts()): DailyEntry[] {
  const pool = bank(schedule, verdicts);
  const priority = (id: string) => verdicts.get(id)?.priority ?? 0;
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
    const pick = pool.filter((p) => age(p.category) === oldest).sort((a, b) => priority(b.id) - priority(a.id))[0];
    pool.splice(pool.indexOf(pick), 1);
    out.push({ n, date, id: pick.id });
    lastUsed.set(pick.category, schedule.length + i);
    date = addDays(date, 1);
    n++;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const days = Number(process.argv[2] ?? 7);
  const write = process.argv.includes("--write");
  const schedule = readSchedule();
  const verdicts = readVerdicts();
  const today = new Date().toISOString().slice(0, 10);
  const next = nextEntries(schedule, days, today, verdicts);
  const why = (id?: string) => (id ? `${id} (priority ${verdicts.get(id)?.priority}): ${verdicts.get(id)?.summary}` : "none approved");
  for (const e of next) console.log(`#${e.n} ${e.date}  ${why(e.id)}`);
  if (next.length < days) console.log(`only ${next.length} of ${days} days filled: judge more lists (docs/JUDGE.md)`);
  console.log(`${bank(schedule, verdicts).length - next.length} approved lists left in the bank after this batch`);
  if (write) writeFileSync(FILE, JSON.stringify([...schedule, ...next], null, 1) + "\n");
  else console.log("(dry run: add --write to save)");
}
