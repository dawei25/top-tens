// Checks every built puzzle in public/puzzles for likely data problems.
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/validate.ts
// Exits 1 if any hard error is found; warnings are printed but don't fail.
import { TEST_SET } from "./topics";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/game/match";
import type { Entry, Puzzle } from "../src/game/types";
import { INTENT } from "./intent";
import { bareWord, gluedAlias, junkRedirect } from "./aliases";
import { UNIVERSES } from "./gazetteer";
import { NOT_PUZZLES } from "./lexicon";
import { TOPICS } from "./topics";

const DIR = join(import.meta.dirname, "..", "public", "puzzles");
/** Neighbours in a ranking more than this far apart (ratio of their numbers) get a second look. */
const JUMP = 20;
const COUNTRY_SET = new Set(UNIVERSES.countries().map((c) => normalize(c.name)));
/** Country, state and capital names. */
const PLACES = new Set(
  [...UNIVERSES.countries(), ...UNIVERSES["us-states"](), ...UNIVERSES.capitals()].map((c) => normalize(c.name)),
);
const NO_PLACES = new Set<string>();
/** Lists of places, where a place name alias is expected. */
const isPlaceList = (p: Puzzle) => {
  const t = TOPICS.find((x) => x.id === p.id);
  return !!t?.universe || /cities|capitals|countries|population|states|metros|islands/.test(p.id);
};
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

  const topic = TOPICS.find((t) => t.id === p.id);
  const built = p as Puzzle & { category?: string };
  if (!built.category) err("missing category");
  else if (topic && built.category !== topic.category) err(`category "${built.category}" differs from topics.ts ("${topic.category}")`);

  // Alias hygiene (scripts/aliases.ts): glued names are broken data; the rest are likely redirects that aren't names.
  const curated = new Set(
    [...Object.values(INTENT[p.id]?.same ?? {}).flat(), ...Object.keys(INTENT[p.id]?.groups ?? {})].map(normalize),
  );
  const junk: string[] = [];
  for (const e of all) {
    const forms = [e.name, ...e.aliases];
    for (const a of e.aliases) {
      if (gluedAlias(a, forms)) err(`"${e.name}": alias "${a}" is several names glued together`);
      if (curated.has(normalize(a))) continue;
      const why = junkRedirect(a, { names: [e.name], forms, works: topic?.works });
      if (why) junk.push(`${e.name}: "${a}" (${why})`);
      // A one-word alias that is a plain word or a place, and no word of the name: "City" for Alaska.
      else if (!normalize(e.name).split(" ").includes(normalize(a)) && bareWord(a, isPlaceList(p) ? NO_PLACES : PLACES)) {
        junk.push(`${e.name}: "${a}" (a plain word or place, not part of the name)`);
      }
    }
  }
  if (junk.length) {
    warn(`${junk.length} alias(es) that look like junk, e.g. ${junk.slice(0, 4).join("; ")}`);
  }

  // Misread numbers: "382.936" among "1,723,337"s is a dot used as a thousands separator.
  const shown = all.filter((e) => e.rank > 0 && e.value).map((e) => [e, e.value!.replace(/^\D+/, "")] as const);
  const grouped = shown.filter(([, v]) => /^\d{1,3}(,\d{3})+/.test(v)).length;
  for (const [e, v] of shown) {
    if (/^\d{1,3}\.\d{3}(?!\d)/.test(v) && grouped > shown.length / 2) {
      err(`#${e.rank} ${e.name}: value "${e.value}" looks misread (a dot as thousands separator)`);
    }
  }
  // A big jump between neighbours in the ranking suggests a misread or mixed units.
  const ranked = all.filter((e) => e.rank > 0 && e.n !== undefined && e.n > 0).sort((a, b) => a.rank - b.rank);
  if (!topic?.lowerIsBetter) {
    for (let i = 1; i < Math.min(ranked.length, 30); i++) {
      const [a, b] = [ranked[i - 1], ranked[i]];
      if (a.n! / b.n! > JUMP) warn(`#${a.rank} ${a.name} (${a.n}) is ${Math.round(a.n! / b.n!)}× #${b.rank} ${b.name} (${b.n}): misread?`);
    }
  }

  // The same country twice: a ranked "Congo" without the aliases of the pool's "Republic of the Congo".
  if ([topic?.universe ?? []].flat().includes("countries")) {
    const countries = all.filter((e) => e.rank === 0 && COUNTRY_SET.has(normalize(e.name)));
    for (const e of all) {
      if (e.rank === 0 || COUNTRY_SET.has(normalize(e.name))) continue;
      const n = normalize(e.name);
      const same = countries.find((c) => ` ${normalize(c.name)} `.includes(` ${n} `));
      if (same) warn(`#${e.rank} "${e.name}" and unranked "${same.name}" may be the same country`);
    }
  }

  // Blitz scores `n`: it must be present on the top 10, follow the ranking, and share one unit across entries.
  for (const e of all) if (e.n !== undefined && !Number.isFinite(e.n)) err(`"${e.name}": n is not a finite number`);
  if (p.blitz) {
    for (const e of p.answers) if (e.n === undefined) err(`#${e.rank} ${e.name}: blitz list without n`);
    const ranked = all.filter((e) => e.rank > 0 && e.n !== undefined).sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < ranked.length; i++) {
      if (ranked[i].n! > ranked[i - 1].n!) {
        warn(`n rises from #${ranked[i - 1].rank} (${ranked[i - 1].n}) to #${ranked[i].rank} ${ranked[i].name} (${ranked[i].n})`);
      }
    }
    const top = p.answers[0]?.n;
    for (const e of all) {
      if (e.rank === 0 && e.n !== undefined && top !== undefined && e.n > top) {
        warn(`unranked "${e.name}" n ${e.n} exceeds #1's ${top} (unit mismatch?)`);
      }
    }
  }
  return issues;
}

function main(): number {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && !NOT_PUZZLES.has(f));
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
  // After `build:test` the index lists only the test set and the scheduled dailies; the other puzzle files are
  // expected to sit unindexed.
  const dailyPath = join(DIR, "daily.json");
  const scheduled = new Set<string>(
    existsSync(dailyPath) ? JSON.parse(readFileSync(dailyPath, "utf8")).map((d: { id: string }) => d.id) : [],
  );
  const testIndex =
    TEST_SET.every((id) => indexIds.has(id)) && [...indexIds].every((id) => TEST_SET.includes(id) || scheduled.has(id));
  if (!testIndex) {
    for (const id of fileIds) if (!indexIds.has(id)) globalIssues.push({ level: "error", msg: `${id}.json is not in index.json` });
  }
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
