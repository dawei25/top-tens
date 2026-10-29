// Builds public/puzzles/*.json from the Wikipedia tables listed in topics.ts.
// Usage: npm run build:puzzles [-- topic-id ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry, Fact, Puzzle } from "../src/game/types";
import { normalize } from "../src/game/match";
import { cleanText, splitHeader, statNumber, tableGrid, wikitables, type Cell } from "./table";
import { TEST_SET, TOPICS, type Topic } from "./topics";
import { fetchCategory, fetchPage, fetchRedirects, pageUrl, requestCount } from "./wiki";
import { addValues } from "./values";
import { writeLexicon } from "./lexicon";
import { tableDataDate } from "./dates";
import { COUNTRY_FORMS, INTENT } from "./intent";
import { UNIVERSES, type Place } from "./gazetteer";

const OUT_DIR = join(import.meta.dirname, "..", "public", "puzzles");
/** Fewest entries with a stat (`n`) for a list to be playable in Blitz. */
const BLITZ_MIN = 30;
/** Wikipedia article behind each entry, where known; only used during the build (values for unranked answers). */
const ARTICLE = new WeakMap<Entry, string>();
const articleOf = (e: Entry) => ARTICLE.get(e) ?? e.name;
/** Every table row is an accepted answer; this only guards against runaway tables. */
const MAX_ROWS = 1000;

interface Row {
  name: string;
  value: number;
  valueText: string;
  aliasSeeds: string[];
  redirectTarget: string;
}

function column(header: string[], spec: string | number): number {
  if (typeof spec === "number") return spec;
  const i = header.findIndex((h) => h.toLowerCase().includes(spec.toLowerCase()));
  if (i < 0) throw new Error(`no column matching "${spec}" in [${header.join(" | ")}]`);
  return i;
}

function cleanName(s: string): string {
  return cleanText(s)
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[†‡*^#⁂§¤]+/g, "")
    .replace(/^"|"$/g, "")
    .replace(/\s+(&|and) family$/i, "")
    .trim();
}

/** First number in a cell. A range ("2–4 billion") ranks by its low end and displays in full. */
export function parseValue(text: string): { value: number; display: string } | null {
  const m = text.match(
    /([$€£]?)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*[–-]\s*[$€£]?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?))?\s*(million|billion|trillion)?/i,
  );
  if (!m) return null;
  const mult = { million: 1e6, billion: 1e9, trillion: 1e12 }[m[4]?.toLowerCase() ?? ""] ?? 1;
  const digits = m[2].replace(/^0+(?=\d)/, "");
  const range = m[3] ? `–${m[3]}` : "";
  return {
    value: parseFloat(digits.replace(/,/g, "")) * mult,
    display: `${m[1]}${digits}${range}${m[4] ? " " + m[4].toLowerCase() : ""}`,
  };
}

/** Aliases a player could type: at least two letters or digits, and not a bare number ("V", "2"). */
function usableAlias(alias: string, name: string): boolean {
  const n = normalize(alias);
  if (n.replace(/ /g, "").length < 2) return false;
  return !/^\d+$/.test(n) || /^\d+$/.test(normalize(name));
}

const GENERIC_WORDS =
  /\b(international airport|airport|stadium|mount|lake|island|corporation|corp|company|inc|group|tower|the)\b/gi;

/** "PUBG: Battlegrounds" → PUBG, Battlegrounds; "Atlanta International Airport" → Atlanta. Collisions are pruned later. */
function shortForms(name: string, strip?: RegExp): string[] {
  // "Family Computer/Nintendo Entertainment System", "Mississippi–Missouri", "PUBG: Battlegrounds".
  const out = name.split(/\s*[:–/]\s*|\s+-\s+/).filter((p) => p !== name);
  // Hawaiʻi is typed "Hawaii": normalize() keeps the ʻokina as a word break.
  if (/[ʻʼ`]/.test(name)) out.push(name.replace(/[ʻʼ`]/g, ""));
  for (const words of [GENERIC_WORDS, strip]) {
    if (!words) continue;
    const stripped = name.replace(words, " ").replace(/\s+/g, " ").trim();
    if (stripped !== name) out.push(stripped);
  }
  return out.filter((s) => s.replace(/\W/g, "").length >= 3);
}

function cellName(cell: Cell, topic: Pick<Topic, "nameFromText" | "nameFromLink" | "nameStrip">): string {
  if (topic.nameFromLink && cell.link) return cleanName(cell.link);
  let name = cleanName(topic.nameFromText || !cell.linkText ? cell.text : cell.linkText);
  if (topic.nameStrip) name = name.replace(topic.nameStrip, "").trim();
  // Untypeable names ("Маша и Медведь") fall back to the linked article's title, if that is typeable.
  if (!normalize(name) && cell.link && normalize(cleanName(cell.link))) return cleanName(cell.link);
  return name;
}

/** Total rows, notes and tier headings ("$50 billion+") that tables mix in with real rows. */
const SKIP_NAME = /^(totals?|grand total|subtotal|as of\b|world( total)?$|others?$|various$|unknown$|[$€£]\d)/i;

/** Use the linked article for redirects only if it is about the thing itself ("Avatar (2009 film)", not "Demographics of India"). */
function redirectTarget(name: string, cell: Cell): string {
  if (!cell.link) return name;
  const link = normalize(cleanName(cell.link));
  // "Lake Baikal" for "Baikal" is the same thing; "Demographics of India" is not.
  if (link === normalize(name) || (link.includes(normalize(name)) && !/\b(of|in|at)\b/.test(link))) return cell.link;
  return name;
}

/**
 * The universe member a cell names, for tables that list franchise histories
 * ("Boston / Milwaukee / Atlanta Braves" is the Atlanta Braves): matched by full name or by nickname at the end.
 */
function universeName(text: string, members: Place[]): string | undefined {
  const t = normalize(text);
  const hit = (form: string) => t === normalize(form) || t.endsWith(" " + normalize(form));
  return (members.find((m) => hit(m.name)) ?? members.find((m) => m.aliases.some(hit)))?.name;
}

async function readRows(topic: Topic): Promise<Row[]> {
  const $ = await fetchPage(topic.page);
  const tables = wikitables($);
  const rows: Row[] = [];
  const members = topic.canonical ? [topic.universe ?? []].flat().flatMap((u) => UNIVERSES[u]()) : [];
  for (const t of topic.tables) {
    const { header, body } = splitHeader(tableGrid($, tables[t]));
    const nc = column(header, topic.name);
    const vc = column(header, topic.value);
    const aliasCs = (topic.aliasCols ?? []).map((a) => column(header, a));
    for (const r of body) {
      const nameCell = r[nc];
      const valueCell = r[vc];
      if (!nameCell || !valueCell || nameCell.isHeader && !nameCell.text) continue;
      if (topic.rankedOnly && !/^\d/.test(r[0]?.text ?? "")) continue;
      const name = (members.length && universeName(nameCell.text, members)) || cellName(nameCell, topic);
      if (!name || !normalize(name) || topic.skip?.includes(name) || SKIP_NAME.test(name)) continue;
      if (topic.where && !topic.where.match.test(r[column(header, topic.where.col)]?.text ?? "")) continue;
      if (/\d{3,}.*\d{3,}/.test(name)) continue; // ad uploads and other non-titles
      const v = parseValue(valueCell.text);
      if (!v) continue;
      const seeds = [nameCell.text, nameCell.linkText ?? "", ...shortForms(name, topic.stripWords)];
      // The cell can say more than the name: "Mississippi–Missouri–Jefferson" names the Mississippi row.
      if (cleanName(nameCell.text) !== name) seeds.push(...shortForms(cleanName(nameCell.text)));
      for (const c of aliasCs) {
        const cell = r[c];
        // "Atlanta, Georgia" names the row by "Atlanta", not by "Georgia": keep the first part of a place.
        if (cell) seeds.push(cell.linkText ?? "", ...cell.text.split("/").map((part) => part.split(",")[0]));
      }
      // The article's own title is never among its redirects ("Acadia National Park" for "Acadia").
      const target = redirectTarget(name, nameCell);
      if (target !== name) seeds.push(target);
      rows.push({
        name,
        value: v.value,
        valueText: v.display,
        aliasSeeds: seeds.map(cleanName).filter((s) => s && s.length > 1),
        redirectTarget: target,
      });
    }
  }
  if (!topic.keepOrder) rows.sort((a, b) => b.value - a.value);
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(normalize(r.name)) && seen.add(normalize(r.name)));
}

/** Unranked accepted answers from other tables (or pages): names only, aliases from the cell and short forms. */
async function readAlso(topic: Topic): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const src of topic.also ?? []) {
    const $ = await fetchPage(src.page ?? topic.page);
    const tables = wikitables($);
    for (const t of src.tables) {
      const { header, body } = splitHeader(tableGrid($, tables[t]));
      const nc = column(header, src.name);
      for (const r of body) {
        const cell = r[nc];
        if (!cell || (cell.isHeader && !cell.text)) continue;
        const name = cellName(cell, src);
        if (!name || !normalize(name) || SKIP_NAME.test(name)) continue;
        if (topic.skip?.includes(name) || src.skip?.includes(name)) continue;
        if (/\d{3,}.*\d{3,}/.test(name)) continue;
        const aliases = [cell.text, cell.linkText ?? "", ...shortForms(name, topic.stripWords)].map(cleanName);
        const entry: Entry = { rank: 0, name, aliases: aliases.filter((a) => a && a !== name) };
        ARTICLE.set(entry, redirectTarget(name, cell));
        out.push(entry);
      }
    }
  }
  for (const cat of topic.universeCategories ?? []) {
    const titles = await fetchCategory(cat, topic.categoryDepth ?? 0, CATEGORY_CAP);
    if (!titles.length) console.log(`warn ${topic.id}: category "${cat}" is empty or missing`);
    for (const title of titles) {
      if (CATEGORY_SKIP.test(title)) continue;
      const name = cleanName(title);
      if (!normalize(name) || SKIP_NAME.test(name)) continue;
      const entry: Entry = { rank: 0, name, aliases: name === title ? [] : [title] };
      ARTICLE.set(entry, title);
      out.push(entry);
    }
  }
  return out;
}

/** Most titles taken from a topic's categories. */
const CATEGORY_CAP = 3000;
/** Category members that are not things a player would name: lists, overviews, years, other namespaces. */
const CATEGORY_SKIP =
  /^((lists?|index|outline|history|timeline|glossary|bibliography|discography|filmography) of\b|\d{3,4}\b|(category|template|wikipedia|portal|file|help|draft|module):)/i;

/** An alias shared by more entries than this is too generic to mean any of them ("Mount", "Lake"). */
const MAX_GROUP = 4;

/**
 * Alias hygiene. An alias that is another entry's name is dropped (typing "Avatar" means Avatar).
 * An alias shared by 2-4 entries stays on all of them, so the game can ask which one was meant; the same goes
 * for an alias that starts other entries' names ("Grand Theft Auto" joins GTA V, GTA IV and San Andreas).
 * Anything broader is dropped.
 */
function pruneAliases(entries: Entry[]): void {
  const owners = new Map<string, Set<Entry>>();
  const byName = new Map<string, Entry>();
  for (const e of entries) {
    byName.set(normalize(e.name), e);
    for (const form of [e.name, ...e.aliases]) {
      const n = normalize(form);
      if (!owners.has(n)) owners.set(n, new Set());
      owners.get(n)!.add(e);
    }
  }
  const names = [...byName.keys()];
  const kept = new Map<Entry, Map<string, string>>(entries.map((e) => [e, new Map()]));
  for (const e of entries) {
    const own = normalize(e.name);
    for (const a of e.aliases) {
      const n = normalize(a);
      if (!n || n === own || kept.get(e)!.has(n) || !usableAlias(a, e.name)) continue;
      const named = byName.get(n);
      if (named && named !== e) continue;
      const group = new Set(owners.get(n));
      for (const other of names) if (other !== own && other.startsWith(n + " ")) group.add(byName.get(other)!);
      if (group.size > MAX_GROUP) continue;
      for (const g of group) if (!kept.get(g)!.has(n) && normalize(g.name) !== n) kept.get(g)!.set(n, a);
    }
  }
  for (const e of entries) e.aliases = [...kept.get(e)!.values()];
}

const COUNTRY_NAMES = new Set(UNIVERSES.countries().map((c) => normalize(c.name)));

interface Curated {
  alias: string;
  targets: Entry[];
  /** Topic-specific intent is checked strictly; shared country forms are skipped where they don't fit. */
  strict: boolean;
}

/** Curated aliases for a topic: shared country forms (for country lists), then the topic's own intent. */
function curated(topic: Topic, entries: Entry[], final: boolean): Curated[] {
  const out: Curated[] = [];
  if ([topic.universe ?? []].flat().includes("countries")) {
    for (const forms of COUNTRY_FORMS) {
      const set = new Set(forms.map(normalize));
      let hits = entries.filter((e) => set.has(normalize(e.name)));
      if (!hits.length) hits = entries.filter((e) => e.aliases.some((a) => set.has(normalize(a))));
      if (hits.length !== 1) continue;
      for (const alias of forms) out.push({ alias, targets: hits, strict: false });
    }
  }
  const intent = INTENT[topic.id];
  if (!intent) return out;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const find = (names: string[]): Entry[] =>
    names.flatMap((name) => {
      const e = byName.get(name);
      if (!e && final) console.log(`warn ${topic.id}: intent.ts names "${name}", which is not an entry`);
      return e ? [e] : [];
    });
  for (const [name, aliases] of Object.entries(intent.same ?? {})) {
    for (const alias of aliases) out.push({ alias, targets: find([name]), strict: true });
  }
  for (const [alias, members] of Object.entries(intent.groups ?? {})) {
    out.push({ alias, targets: find(members), strict: true });
  }
  return out;
}

/**
 * Put curated aliases on the entries that exist so far, before universe members are merged in, so that
 * "United Kingdom" (meaning Great Britain on the islands list) does not come back as a separate country entry.
 */
function seedIntent(topic: Topic, entries: Entry[]): void {
  for (const { alias, targets } of curated(topic, entries, false)) for (const e of targets) e.aliases.push(alias);
}

/** Curated aliases win over automatic ones with the same spelling: they move to exactly their targets. */
function applyIntent(topic: Topic, entries: Entry[]): void {
  for (const { alias, targets, strict } of curated(topic, entries, true)) {
    const n = normalize(alias);
    if (!targets.length) continue;
    const clash = entries.find((e) => normalize(e.name) === n && !targets.includes(e));
    if (clash) {
      if (strict) console.log(`warn ${topic.id}: intent.ts alias "${alias}" is the name of "${clash.name}", skipped`);
      continue;
    }
    for (const e of entries) {
      const rest = e.aliases.filter((a) => normalize(a) !== n);
      e.aliases = targets.includes(e) && normalize(e.name) !== n ? [...rest, alias] : rest;
    }
  }
}

const FACTS_DIR = join(import.meta.dirname, "facts");

/**
 * Curated fun facts for a topic, keyed by entry name: scripts/facts/<topic id>.json. Each may also carry an
 * `evidence` quote from the article for review; only text and source ship.
 */
function readFacts(id: string): Record<string, Fact> {
  const file = join(FACTS_DIR, `${id}.json`);
  if (!existsSync(file)) return {};
  const raw: Record<string, Fact & { evidence?: string }> = JSON.parse(readFileSync(file, "utf8"));
  return Object.fromEntries(Object.entries(raw).map(([name, f]) => [name, { text: f.text, source: f.source }]));
}

/** When the topic's first source table says its numbers are from. */
async function dataDate(topic: Topic): Promise<string | undefined> {
  if (topic.dataAsOf) return topic.dataAsOf;
  const $ = await fetchPage(topic.page);
  const table = wikitables($)[topic.tables[0]];
  const { header } = splitHeader(tableGrid($, table));
  const vh = typeof topic.value === "number" ? header[topic.value] : header[column(header, topic.value)];
  return tableDataDate($, table, vh ?? "");
}

async function buildPuzzle(topic: Topic): Promise<Puzzle> {
  const rows = (await readRows(topic)).slice(0, MAX_ROWS);
  if (rows.length < 10) throw new Error(`only ${rows.length} rows`);
  if (rows.length > 10 && rows[9].value === rows[10].value) {
    throw new Error(`tie at #10/#11: ${rows[9].name} / ${rows[10].name}`);
  }

  const facts = readFacts(topic.id);
  const entries: Entry[] = [];
  for (const [i, row] of rows.entries()) {
    const aliases = new Set(row.aliasSeeds);
    for (const r of await fetchRedirects(row.redirectTarget, i >= 10)) {
      // A redirect from another country's name ("China" to Taiwan) would hand that name to the wrong entry.
      const n = normalize(r);
      if (COUNTRY_NAMES.has(n) && n !== normalize(row.name)) continue;
      aliases.add(r);
    }
    for (const a of topic.aliases?.[row.name] ?? []) aliases.add(a);
    if (topic.people) {
      const last = row.name.split(" ").at(-1)!;
      if (last.length >= 4) aliases.add(last);
    }
    const fact = i < 10 ? facts[row.name] : undefined;
    entries.push({
      rank: i + 1,
      name: row.name,
      aliases: [...aliases],
      value: (topic.prefix ?? "") + row.valueText + (topic.unit ?? ""),
      ...(Number.isFinite(row.value) ? { n: statNumber(row.value) } : {}),
      ...(i < 10 ? { article: row.redirectTarget } : {}),
      ...(fact ? { fact } : {}),
    });
  }

  // Unranked but real: rows from other tables, and members of the topic's universe (every country, every
  // state, every team) that the table leaves out, still count as (wrong) answers.
  seedIntent(topic, entries);
  const extra = await readAlso(topic);
  for (const u of [topic.universe ?? []].flat()) extra.push(...UNIVERSES[u]().map((p) => ({ rank: 0, ...p })));
  const taken = new Set(entries.flatMap((e) => [e.name, ...e.aliases].map(normalize)));
  for (const e of extra) {
    const forms = [e.name, ...e.aliases].map(normalize).filter(Boolean);
    if (forms.some((f) => taken.has(f))) continue;
    // Add-ons of an entry already listed ("Skyrim – Dragonborn" next to Skyrim) only blur what its name means.
    const base = e.name.split(" – ")[0];
    if (base !== e.name && taken.has(normalize(base))) continue;
    entries.push(e);
    taken.add(normalize(e.name));
  }

  pruneAliases(entries);
  applyIntent(topic, entries);
  if (topic.values) {
    const [found, tried] = await addValues(topic, entries, articleOf, rows.map((r) => r.value));
    console.log(`     ${topic.id}: values for ${found} of ${tried} likely unranked answers`);
  }
  const dataAsOf = await dataDate(topic);

  return {
    id: topic.id,
    title: topic.title,
    prompt: topic.prompt,
    metric: topic.metric,
    ...(!topic.lowerIsBetter && entries.filter((e) => e.n !== undefined).length >= BLITZ_MIN ? { blitz: true } : {}),
    source: {
      name: `Wikipedia: ${topic.page}`,
      url: pageUrl(topic.page),
      asOf: new Date().toISOString().slice(0, 10),
      ...(dataAsOf ? { dataAsOf } : {}),
    },
    answers: entries.slice(0, 10),
    extras: entries.slice(10),
  };
}

// `--test` builds only the test set (fast iteration) and indexes just those lists; ids build only those ids
// (index untouched); no arguments builds everything.
const args = process.argv.slice(2);
const testMode = args.includes("--test");
// Test mode also builds every list on the daily schedule, so scheduled dailies always exist and are indexed.
const scheduled: string[] = existsSync(join(OUT_DIR, "daily.json"))
  ? JSON.parse(readFileSync(join(OUT_DIR, "daily.json"), "utf8")).map((e: { id: string }) => e.id)
  : [];
const only = testMode ? [...new Set([...TEST_SET, ...scheduled])] : args.filter((a) => !a.startsWith("--"));
mkdirSync(OUT_DIR, { recursive: true });
const index: { id: string; title: string; category: string; blitz: boolean }[] = [];
for (const topic of TOPICS) {
  if (only.length && !only.includes(topic.id)) continue;
  try {
    const p = await buildPuzzle(topic);
    writeFileSync(join(OUT_DIR, `${p.id}.json`), JSON.stringify(p));
    index.push({ id: p.id, title: p.title, category: topic.category, blitz: !!p.blitz });
    console.log(`ok   ${p.id.padEnd(24)} ${p.answers.map((a) => a.name).join(", ")}`);
  } catch (err) {
    console.log(`FAIL ${topic.id.padEnd(24)} ${(err as Error).message}`);
  }
}
if (!only.length || testMode) writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(index, null, 1));
console.log(`lexicon trained on ${writeLexicon(OUT_DIR)} names`);
console.log(`${requestCount()} Wikipedia requests (the rest came from the cache)`);
