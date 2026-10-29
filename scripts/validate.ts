// Checks every built puzzle in public/puzzles for likely data problems.
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/validate.ts
// Exits 1 if any hard error is found; warnings are printed but don't fail.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/game/match";
import type { Entry, Puzzle } from "../src/game/types";
import { INTENT } from "./intent";
import { TOPICS } from "./topics";

const DIR = join(import.meta.dirname, "..", "public", "puzzles");
/** Below this many accepted answers, wrong-but-real guesses are likely to be free. */
const MIN_ACCEPTED = 30;

type Level = "error" | "warn";
interface Issue {
  level: Level;
  msg: string;
}

/** Why a name looks like table debris rather than an answer, or null if it looks fine. */
export function junkReason(name: string): string | null {
  if (/\[\s*\w{0,8}\s*\]/.test(name)) return "footnote marker";
  if (/^(list|lists|table) of\b/i.test(name)) return 'starts with "List of"';
  if (/^(grand )?(totals?|subtotal|overall|world|others?|various|unknown|n\/a|rest of( the)? world)$/i.test(name.trim())) {
    return "total/placeholder row";
  }
  // Titles can be numbers ("1989", "21", "2012"); table debris looks like "1,286" or a long serial.
  if (/\d{6,}/.test(name)) return "long digit run";
  if (/^[\d\s.,%$€£()+-]+$/.test(name) && (/,\d{3}/.test(name) || /\d{5,}/.test(name))) return "a number, not a name";
  if (/\b(citation needed|ref\.)|^(notes?|see also)$/i.test(name)) return "note text";
  if (name.length > 80) return "very long";
  if (/^[^\p{L}\p{N}"'¡¿(.&+]/u.test(name)) return "starts with punctuation";
  return null;
}

function checkPuzzle(p: Puzzle, file: string): Issue[] {
  const issues: Issue[] = [];
  const err = (msg: string) => issues.push({ level: "error", msg });
  const warn = (msg: string) => issues.push({ level: "warn", msg });

  if (p.id + ".json" !== file) err(`id "${p.id}" doesn't match file name`);
  for (const k of ["title", "prompt"] as const) if (!p[k]?.trim()) err(`missing ${k}`);
  if (!p.source?.url || !p.source?.asOf) err("missing source url or asOf");
  if (p.answers.length !== 10) err(`${p.answers.length} answers, expected 10`);

  p.answers.forEach((e, i) => {
    if (e.rank !== i + 1) err(`answer #${i + 1} has rank ${e.rank}`);
    if (!e.value?.trim()) err(`#${e.rank} ${e.name}: missing value`);
    if (!e.aliases.length) warn(`#${e.rank} ${e.name}: no aliases`);
  });

  const all: Entry[] = [...p.answers, ...p.extras];
  if (all.length < MIN_ACCEPTED) warn(`only ${all.length} accepted answers (want ${MIN_ACCEPTED}+)`);

  let lastRank = 10;
  for (const e of p.extras) {
    if (e.rank === 0) continue;
    if (e.rank !== lastRank + 1) err(`extras rank jumps from ${lastRank} to ${e.rank} (${e.name})`);
    lastRank = e.rank;
  }

  const byName = new Map<string, Entry>();
  for (const e of all) {
    const where = e.rank ? `#${e.rank}` : "unranked";
    const why = junkReason(e.name);
    if (why) (e.rank >= 1 && e.rank <= 10 ? err : warn)(`${where} "${e.name}": looks like junk (${why})`);
    const n = normalize(e.name);
    if (!n) err(`${where} "${e.name}": normalizes to nothing`);
    const prev = byName.get(n);
    if (prev) err(`duplicate entry "${e.name}" (#${prev.rank || "-"} and #${e.rank || "-"})`);
    else byName.set(n, e);
    for (const a of e.aliases) {
      const na = normalize(a);
      if (na.replace(/[^a-z0-9]/g, "").length < 2) err(`${where} "${e.name}": alias "${a}" shorter than 2 letters`);
    }
  }

  // Shared aliases are groups ("Did you mean A or B?"); a big group means the alias is too generic.
  const owners = new Map<string, number>();
  for (const e of all) for (const a of new Set(e.aliases.map(normalize))) owners.set(a, (owners.get(a) ?? 0) + 1);
  for (const [a, n] of owners) if (n > 4) warn(`alias "${a}" is shared by ${n} entries`);

  // An alias equal to another entry's name shadows that entry, unless intent.ts made it a group on purpose.
  const curatedGroups = new Set(Object.keys(INTENT[p.id]?.groups ?? {}).map(normalize));
  for (const e of all) {
    for (const a of e.aliases) {
      const other = byName.get(normalize(a));
      if (other && other !== e && !curatedGroups.has(normalize(a))) {
        err(`alias "${a}" of "${e.name}" is the name of "${other.name}"`);
      }
    }
  }
  return issues;
}

function main(): number {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json" && f !== "lexicon.json");
  const globalIssues: Issue[] = [];

  const indexPath = join(DIR, "index.json");
  const index: { id: string; title: string; category: string }[] = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : [];
  if (!index.length) globalIssues.push({ level: "error", msg: "index.json missing or empty" });
  if (!existsSync(join(DIR, "lexicon.json"))) globalIssues.push({ level: "error", msg: "lexicon.json missing" });
  const indexIds = new Set(index.map((m) => m.id));
  const fileIds = new Set(files.map((f) => f.replace(/\.json$/, "")));
  const topicIds = new Set(TOPICS.map((t) => t.id));
  for (const id of indexIds) if (!fileIds.has(id)) globalIssues.push({ level: "error", msg: `index.json lists "${id}" but there is no ${id}.json` });
  for (const id of fileIds) if (!indexIds.has(id)) globalIssues.push({ level: "error", msg: `${id}.json is not in index.json` });
  for (const id of fileIds) if (!topicIds.has(id)) globalIssues.push({ level: "warn", msg: `${id}.json has no topic in topics.ts (stale file?)` });
  for (const id of topicIds) if (!fileIds.has(id)) globalIssues.push({ level: "warn", msg: `topic "${id}" has no built puzzle (build failed?)` });
  if (indexIds.size !== index.length) globalIssues.push({ level: "error", msg: "index.json has duplicate ids" });
  for (const m of index) {
    if (!m.title || !m.category) globalIssues.push({ level: "error", msg: `index.json entry "${m.id}" lacks title or category` });
    const file = join(DIR, `${m.id}.json`);
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).title !== m.title) {
      globalIssues.push({ level: "error", msg: `index.json title for "${m.id}" differs from the puzzle's` });
    }
  }

  let errors = 0;
  let warnings = 0;
  const print = (label: string, issues: Issue[]) => {
    if (!issues.length) return;
    console.log(`\n${label}`);
    for (const i of issues) {
      console.log(`  ${i.level === "error" ? "ERROR" : "warn "} ${i.msg}`);
      if (i.level === "error") errors++;
      else warnings++;
    }
  };

  print("index", globalIssues);
  const sizes: [string, number][] = [];
  for (const f of files.sort()) {
    let p: Puzzle;
    try {
      p = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    } catch (e) {
      print(f, [{ level: "error", msg: `unreadable: ${(e as Error).message}` }]);
      continue;
    }
    sizes.push([p.id, p.answers.length + p.extras.length]);
    print(`${p.id} (${p.answers.length + p.extras.length} accepted)`, checkPuzzle(p, f));
  }

  sizes.sort((a, b) => a[1] - b[1]);
  console.log(`\n${files.length} puzzles, ${index.length} in index. Smallest: ${sizes.slice(0, 5).map(([id, n]) => `${id} ${n}`).join(", ")}`);
  console.log(`${errors} error(s), ${warnings} warning(s)`);
  return errors ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
