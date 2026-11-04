// Extends the daily schedule (public/puzzles/daily.json) with the next N days. Only lists a list judge approved can
// run (docs/JUDGE.md, verdicts in scripts/judge/verdicts/; a builder's provisional verdict doesn't count): Today's
// list from `daily-list` verdicts, highest priority first, rotating categories, and a different topic as Today's
// Blitz (`assignBlitz`). The file is the record of what ran when.
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
  scores?: { blitzDepth?: number; recognizability?: number; data?: number };
  blitzCasual?: { scored?: number } | null;
  tags?: string[];
  judgedAt?: string;
  /** "builder": written by the data agent that built the list, pending a real judge. Never scheduled. */
  by?: "builder";
  /** The owner's call that this list never runs as Today's list, with why. A re-judge keeps it. */
  ownerVeto?: string;
}

const VERDICTS = join(import.meta.dirname, "judge", "verdicts");

export function readVerdicts(): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  if (!existsSync(VERDICTS)) return out;
  for (const f of readdirSync(VERDICTS)) {
    if (!f.endsWith(".json")) continue;
    const v: Verdict = JSON.parse(readFileSync(join(VERDICTS, f), "utf8"));
    // A builder rates its own list: useful for par, not enough to run it as a daily.
    if (v.by !== "builder") out.set(v.id, v);
  }
  return out;
}

/** When the 5-to-6 average bar started (docs/JUDGE.md); older daily verdicts were judged against an easier one. */
const DAILY_BAR = "2026-11-02";
const listOk = (v?: Verdict) => v?.decision === "daily-list" && (v.judgedAt ?? "") >= DAILY_BAR && !v.ownerVeto;
const blitzReady = (id: string) => JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8")).blitz === true;
/**
 * Today's Blitz bar (docs/JUDGE.md): breadth, not the top 10. A deep pool a casual player keeps scoring in, broad
 * recognition and clean data (older `daily-blitz` verdicts included, if their scores meet it). A list may qualify for
 * both pools (fast food chains), but never runs twice.
 */
const blitzOk = (id: string, v?: Verdict) =>
  !!v &&
  blitzReady(id) &&
  v.decision !== "reject" &&
  v.decision !== "fix-first" &&
  (v.scores?.blitzDepth ?? 0) >= 4 &&
  (v.scores?.data ?? 0) >= 4 &&
  (v.scores?.recognizability ?? 0) >= 4;

/** Every list that has run as a daily, either way. */
const usedIds = (schedule: DailyEntry[]) => new Set(schedule.flatMap((e) => (e.blitz ? [e.id, e.blitz] : [e.id])));

/** Built topics the judge approved for Today's list and that have never been a daily. */
export function bank(schedule: DailyEntry[], verdicts = readVerdicts()): { id: string; category: string }[] {
  // A list that already ran as a Blitz isn't a fresh daily either.
  const used = usedIds(schedule);
  return TOPICS.filter((t) => !used.has(t.id) && existsSync(join(DIR, `${t.id}.json`)) && listOk(verdicts.get(t.id))).map(
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
  assignBlitz(out, schedule, verdicts);
  return out;
}

/**
 * Give each entry without one its own Today's Blitz: a different topic from any day's list, never one that ran
 * before, deepest Blitz first, keeping lists that could be a daily list for that pool. For variety it avoids the
 * day's list's category and the day before's Blitz category, and any specific topic tag ("usa", "cities") shared with
 * the day's list or the two Blitzes before it.
 */
export function assignBlitz(entries: DailyEntry[], schedule: DailyEntry[], verdicts = readVerdicts()): void {
  const category = new Map(TOPICS.map((t) => [t.id, t.category]));
  const taken = usedIds([...schedule, ...entries]);
  const depth = (id: string) => verdicts.get(id)?.blitzCasual?.scored ?? 0;
  const listCandidate = (id: string) => (listOk(verdicts.get(id)) ? 1 : 0);
  const pool = TOPICS.map((t) => t.id)
    .filter((id) => !taken.has(id) && existsSync(join(DIR, `${id}.json`)) && blitzOk(id, verdicts.get(id)))
    .sort((a, b) => listCandidate(a) - listCandidate(b) || depth(b) - depth(a) || (verdicts.get(b)?.priority ?? 0) - (verdicts.get(a)?.priority ?? 0));
  // Tags past the first (broad) one: "usa", "cities", "basketball".
  const same: Record<string, string> = { us: "usa", "united states": "usa", "us states": "usa" };
  const tags = (id?: string) => (id ? (verdicts.get(id)?.tags ?? []).slice(1).map((t) => same[t] ?? t) : []);
  const recent = [...schedule].flatMap((e) => (e.blitz ? [e.blitz] : [])).slice(-2);
  for (const e of entries) {
    if (e.blitz) {
      recent.push(e.blitz);
      continue;
    }
    const previous = recent.at(-1);
    const avoidCategory = new Set([category.get(e.id), previous && category.get(previous)]);
    const avoidTags = new Set([...tags(e.id), ...recent.slice(-2).flatMap(tags)]);
    const varied = (id: string) => !avoidCategory.has(category.get(id)) && !tags(id).some((t) => avoidTags.has(t));
    const pick = pool.find(varied) ?? pool.find((id) => !avoidCategory.has(category.get(id))) ?? pool[0];
    if (!pick) break;
    e.blitz = pick;
    pool.splice(pool.indexOf(pick), 1);
    recent.push(pick);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Usage: schedule.ts <days> [--write]   add days (list and Blitz each)
  //        schedule.ts --blitz [--write]  give upcoming days that lack one their own Today's Blitz
  const days = Number(process.argv[2] ?? 7);
  const write = process.argv.includes("--write");
  const schedule = readSchedule();
  const verdicts = readVerdicts();
  const today = new Date().toISOString().slice(0, 10);
  const why = (id?: string) => (id ? `${id} (priority ${verdicts.get(id)?.priority}): ${verdicts.get(id)?.summary}` : "none approved");
  const show = (e: DailyEntry) => console.log(`#${e.n} ${e.date}\n  list:  ${why(e.id)}\n  blitz: ${why(e.blitz)}`);
  if (process.argv.includes("--blitz")) {
    const upcoming = schedule.filter((e) => e.date >= today);
    assignBlitz(upcoming, schedule.filter((e) => e.date < today), verdicts);
    upcoming.forEach(show);
    if (write) writeFileSync(FILE, JSON.stringify(schedule, null, 1) + "\n");
    else console.log("(dry run: add --write to save)");
  } else {
    const next = nextEntries(schedule, days, today, verdicts);
    next.forEach(show);
    if (next.length < days) console.log(`only ${next.length} of ${days} days filled: judge more lists (docs/JUDGE.md)`);
    console.log(`${bank(schedule, verdicts).length - next.length} approved lists left in the bank after this batch`);
    if (write) writeFileSync(FILE, JSON.stringify([...schedule, ...next], null, 1) + "\n");
    else console.log("(dry run: add --write to save)");
  }
}
