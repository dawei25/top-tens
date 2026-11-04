// Extends the daily schedule (public/puzzles/daily.json) with the next N days. Only lists a list judge approved can
// run (docs/JUDGE.md, verdicts in scripts/judge/verdicts/; a builder's provisional verdict doesn't count): Today's
// list from `daily-list` verdicts, new lists first (`debut` in topics.ts: they wait out of random play for their day),
// rotating categories, highest priority first, and a different topic as Today's Blitz (`assignBlitz`). The file is the
// record of what ran when.
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/schedule.ts <days> [--write]   (dry run without --write)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyEntry } from "../src/game/daily";
import { TOPICS } from "./topics";

const DIR = join(import.meta.dirname, "..", "public", "puzzles");
const FILE = join(DIR, "daily.json");

export function addDays(date: string, days: number): string {
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

/** A built list, as the scheduler sees it. */
export interface ListInfo {
  id: string;
  category: string;
  /** Playable in Blitz (the built puzzle's `blitz`). */
  blitz: boolean;
  /** New, held out of random play until it runs as a daily (topics.ts `debut`). */
  debut?: boolean;
}

/** Every built topic, in topic order. */
export function builtLists(): ListInfo[] {
  return TOPICS.filter((t) => existsSync(join(DIR, `${t.id}.json`))).map((t) => ({
    id: t.id,
    category: t.category,
    blitz: JSON.parse(readFileSync(join(DIR, `${t.id}.json`), "utf8")).blitz === true,
    ...(t.debut ? { debut: true } : {}),
  }));
}

/** When the 5-to-6 average bar started (docs/JUDGE.md); older daily verdicts were judged against an easier one. */
const DAILY_BAR = "2026-11-02";
export const listOk = (v?: Verdict) => v?.decision === "daily-list" && (v.judgedAt ?? "") >= DAILY_BAR && !v.ownerVeto;
/**
 * Today's Blitz bar (docs/JUDGE.md): breadth, not the top 10. A deep pool a casual player keeps scoring in, broad
 * recognition and clean data (older `daily-blitz` verdicts included, if their scores meet it). A list may qualify for
 * both pools (fast food chains), but runs as Today's list only once.
 */
export const blitzOk = (list: ListInfo | undefined, v?: Verdict) =>
  !!v &&
  !!list?.blitz &&
  v.decision !== "reject" &&
  v.decision !== "fix-first" &&
  (v.scores?.blitzDepth ?? 0) >= 4 &&
  (v.scores?.data ?? 0) >= 4 &&
  (v.scores?.recognizability ?? 0) >= 4;

/** A Blitz may run a list again (a rerun) once this many days have passed since it last ran as a Blitz. */
export const BLITZ_RERUN_DAYS = 30;

/** Every list that has run as a daily, either way. */
const usedIds = (schedule: DailyEntry[]) => new Set(schedule.flatMap((e) => (e.blitz ? [e.id, e.blitz] : [e.id])));

/** Built topics the judge approved for Today's list and that have never been a daily. */
export function bank(
  schedule: DailyEntry[],
  verdicts = readVerdicts(),
  lists = builtLists(),
): ListInfo[] {
  // A list that already ran as a Blitz isn't a fresh daily either.
  const used = usedIds(schedule);
  return lists.filter((l) => !used.has(l.id) && listOk(verdicts.get(l.id)));
}

/**
 * The next `days` entries after the last scheduled date (or starting today). Today's list: never the day before's
 * category when another will do; then a new list (`debut`) before one already in random play (owner: dailies should
 * be fresh, and a new list waits out of random play for its day); then the category used longest ago, then the
 * judge's highest priority.
 */
export function nextEntries(
  schedule: DailyEntry[],
  days: number,
  today: string,
  verdicts = readVerdicts(),
  lists = builtLists(),
): DailyEntry[] {
  const pool = bank(schedule, verdicts, lists);
  const priority = (id: string) => verdicts.get(id)?.priority ?? 0;
  const category = new Map(lists.map((l) => [l.id, l.category]));
  const last = schedule.at(-1);
  let date = last && last.date >= today ? addDays(last.date, 1) : today;
  let n = (last?.n ?? 0) + 1;
  const lastUsed = new Map<string, number>();
  schedule.forEach((e, i) => lastUsed.set(category.get(e.id) ?? "", i));
  let previous = last && category.get(last.id);
  const out: DailyEntry[] = [];
  for (let i = 0; i < days && pool.length; i++) {
    const age = (c: string) => lastUsed.get(c) ?? -1;
    const rank = (l: ListInfo) => [l.category === previous ? 1 : 0, l.debut ? 0 : 1, age(l.category), -priority(l.id)];
    const before = (a: ListInfo, b: ListInfo) => {
      const [ra, rb] = [rank(a), rank(b)];
      const k = ra.findIndex((x, j) => x !== rb[j]);
      return k < 0 ? 0 : ra[k] - rb[k];
    };
    const pick = [...pool].sort(before)[0];
    pool.splice(pool.indexOf(pick), 1);
    out.push({ n, date, id: pick.id });
    lastUsed.set(pick.category, schedule.length + i);
    previous = pick.category;
    date = addDays(date, 1);
    n++;
  }
  assignBlitz(out, schedule, verdicts, lists);
  return out;
}

/**
 * Give each entry without one its own Today's Blitz, a different topic from the day's list. First a list that never
 * ran either way, deepest Blitz first, keeping lists that could be a daily list for that pool. When none is left, a
 * day doesn't wait for one (owner): a rerun of a list that already ran (so it is in random play), never the day's
 * list's category, never one that ran as a Blitz in the last `BLITZ_RERUN_DAYS` days or runs again on a later day, the
 * one that ran longest ago first. For variety it avoids the day's list's category and the day before's Blitz
 * category, and any specific topic tag ("usa", "cities") shared with the day's list or the two Blitzes before it.
 */
export function assignBlitz(entries: DailyEntry[], schedule: DailyEntry[], verdicts = readVerdicts(), lists = builtLists()): void {
  const info = new Map(lists.map((l) => [l.id, l]));
  const category = new Map(lists.map((l) => [l.id, l.category]));
  const all = [...schedule, ...entries];
  const taken = usedIds(all);
  const depth = (id: string) => verdicts.get(id)?.blitzCasual?.scored ?? 0;
  const listCandidate = (id: string) => (listOk(verdicts.get(id)) ? 1 : 0);
  const ok = lists.map((l) => l.id).filter((id) => blitzOk(info.get(id), verdicts.get(id)));
  const pool = ok
    .filter((id) => !taken.has(id))
    .sort((a, b) => listCandidate(a) - listCandidate(b) || depth(b) - depth(a) || (verdicts.get(b)?.priority ?? 0) - (verdicts.get(a)?.priority ?? 0));
  // Tags past the first (broad) one: "usa", "cities", "basketball".
  const same: Record<string, string> = { us: "usa", "united states": "usa", "us states": "usa" };
  const tags = (id?: string) => (id ? (verdicts.get(id)?.tags ?? []).slice(1).map((t) => same[t] ?? t) : []);
  const recent = [...schedule].flatMap((e) => (e.blitz ? [e.blitz] : [])).slice(-2);
  /** Lists that already ran before `e`'s day and may run as its Blitz again, the one that ran longest ago first. */
  const reruns = (e: DailyEntry): string[] => {
    const lastRun = new Map<string, string>();
    const later = new Set<string>();
    const recentBlitz = new Set<string>();
    const since = addDays(e.date, -BLITZ_RERUN_DAYS);
    for (const d of all) {
      if (d.date >= e.date) {
        // The day's own list, and any later day's list or Blitz: a Blitz shows every answer.
        later.add(d.id);
        if (d.blitz) later.add(d.blitz);
        continue;
      }
      for (const id of d.blitz ? [d.id, d.blitz] : [d.id]) if ((lastRun.get(id) ?? "") < d.date) lastRun.set(id, d.date);
      if (d.blitz && d.date > since) recentBlitz.add(d.blitz);
    }
    return ok
      .filter((id) => lastRun.has(id) && !later.has(id) && !recentBlitz.has(id) && category.get(id) !== category.get(e.id))
      .sort((a, b) => lastRun.get(a)!.localeCompare(lastRun.get(b)!) || depth(b) - depth(a));
  };
  for (const e of entries) {
    if (e.blitz) {
      recent.push(e.blitz);
      continue;
    }
    const previous = recent.at(-1);
    const avoidCategory = new Set([category.get(e.id), previous && category.get(previous)]);
    const avoidTags = new Set([...tags(e.id), ...recent.slice(-2).flatMap(tags)]);
    const varied = (id: string) => !avoidCategory.has(category.get(id)) && !tags(id).some((t) => avoidTags.has(t));
    const choose = (from: string[]) => from.find(varied) ?? from.find((id) => !avoidCategory.has(category.get(id))) ?? from[0];
    let pick = choose(pool);
    if (pick) pool.splice(pool.indexOf(pick), 1);
    else pick = choose(reruns(e));
    if (!pick) continue;
    e.blitz = pick;
    recent.push(pick);
  }
}

/**
 * New lists that wait out of random play with no day in sight: built with `debut`, not scheduled yet, and either
 * unjudged (a builder's verdict doesn't count) or judged fit for neither Today's list nor Today's Blitz. A list judged
 * for free play only waits for good: drop its `debut` in topics.ts.
 */
export function waitingDebuts(schedule: DailyEntry[], verdicts = readVerdicts(), lists = builtLists()) {
  const used = usedIds(schedule);
  const waiting = lists.filter((l) => l.debut && !used.has(l.id));
  return {
    unjudged: waiting.filter((l) => !verdicts.has(l.id)).map((l) => l.id),
    stuck: waiting
      .filter((l) => verdicts.has(l.id) && !listOk(verdicts.get(l.id)) && !blitzOk(l, verdicts.get(l.id)))
      .map((l) => l.id),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Usage: schedule.ts <days> [--write]   add days (list and Blitz each)
  //        schedule.ts --blitz [--write]  give upcoming days that lack one their own Today's Blitz
  const days = Number(process.argv[2] ?? 7);
  const write = process.argv.includes("--write");
  const schedule = readSchedule();
  const verdicts = readVerdicts();
  const lists = builtLists();
  const today = new Date().toISOString().slice(0, 10);
  const used = usedIds(schedule);
  const tag = (id: string) => (lists.find((l) => l.id === id)?.debut && !used.has(id) ? " [debut]" : used.has(id) ? " [rerun]" : "");
  const why = (id?: string) =>
    id ? `${id}${tag(id)} (priority ${verdicts.get(id)?.priority}): ${verdicts.get(id)?.summary}` : "none approved";
  const show = (e: DailyEntry) => console.log(`#${e.n} ${e.date}\n  list:  ${why(e.id)}\n  blitz: ${why(e.blitz)}`);
  let after = schedule;
  if (process.argv.includes("--blitz")) {
    const upcoming = schedule.filter((e) => e.date >= today);
    assignBlitz(upcoming, schedule.filter((e) => e.date < today), verdicts, lists);
    upcoming.forEach(show);
  } else {
    const next = nextEntries(schedule, days, today, verdicts, lists);
    next.forEach(show);
    if (next.length < days) console.log(`only ${next.length} of ${days} days filled: judge more lists (docs/JUDGE.md)`);
    console.log(`${bank(schedule, verdicts, lists).length - next.length} approved lists left in the bank after this batch`);
    after = [...schedule, ...next];
  }
  if (write) writeFileSync(FILE, JSON.stringify(after, null, 1) + "\n");
  else console.log("(dry run: add --write to save)");
  const { unjudged, stuck } = waitingDebuts(after, verdicts, lists);
  if (unjudged.length) console.log(`new lists waiting for a judge (held from random play): ${unjudged.join(", ")}`);
  if (stuck.length) console.log(`new lists judged unfit for a daily, held from random play for good: drop \`debut\` in topics.ts: ${stuck.join(", ")}`);
}
