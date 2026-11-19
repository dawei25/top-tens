// Name-it lists for Fathom's name-it round ("Name a country with about 50 million people"): every thing of a kind
// with its figure, so any fair answer registers. Written to public/fathom/lists/<id>.json.
//   NODE_NO_WARNINGS=1 NODE_USE_ENV_PROXY=1 npx tsx scripts/fathom/lists.ts [list ids: only those, and only the pages
//   they need, e.g. `cities-population`]
// Reads the built puzzles, three Wikipedia pages for the country lists (cached in .cache/wiki; fetched politely through
// wiki.ts if not) and, for the city list, the agglomerations page (AGGLOMERATIONS, cached the same way, fetched once).
// The checks every file must pass (shape, no shared names or aliases, one set of countries) are `checkList` and
// `checkCountryLists`, run on the committed files by lists.test.ts.
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { placeNamed } from "../../src/game/fathom-name";
import { normalize } from "../../src/game/match";
import type { Entry, Puzzle } from "../../src/game/types";
import { blockedAlias, CITY_JUNK, COUNTRY_JUNK } from "../aliases";
import { CITY_FORMS, COUNTRY_FORMS } from "../intent";
import { splitHeader, tableGrid, wikitables } from "../table";
import { fetchPage, pageUrl } from "../wiki";

const ROOT = join(import.meta.dirname, "..", "..");
export const LISTS_DIR = join(ROOT, "public", "fathom", "lists");
const PUZZLES = join(ROOT, "public", "puzzles");

export interface NameEntry {
  name: string;
  aliases: string[];
  value: number;
}

export interface NameList {
  id: string;
  /** What the player names, singular and plural: "country", "countries". */
  noun: string;
  nounPlural: string;
  /** The plain word the round says after the number: "people", "square kilometres", "land borders". */
  measure: string;
  /** "ratio": scored by how many times off (counts and sizes); "steps": by how many off (a small count). */
  scoring: "ratio" | "steps";
  source: { title: string; url: string };
  /** When the figures are from: "YYYY-MM-DD" or a year. */
  asOf: string;
  entries: NameEntry[];
  /**
   * Things of the list's kind it knows by name with no figure on its measure (the city list, Nov 17: every other city
   * of TENtacle's city lists): "Florence isn't measured here.", and with `partOf` the entry whose figure counts it.
   */
  unmeasured?: { name: string; aliases: string[]; partOf?: string }[];
}

/** The country lists, which share one set of countries (by name) so a country means the same in every round. */
export const COUNTRY_LISTS = ["countries-population", "countries-area", "land-borders", "countries-density"];
/** The US state lists (Nov 17): the 50 states, the same set in both, typed the same way. */
export const STATE_LISTS = ["us-states-population", "us-states-area"];
/** What a US state list names: "Name a US state with about 5 million people". */
export const STATE_NOUN = { noun: "US state", nounPlural: "US states" } as const;

const KEYS = ["id", "noun", "nounPlural", "measure", "scoring", "source", "asOf", "entries", "unmeasured"];

/** Problems with one list file, as readable lines (empty when it is well formed). */
export function checkList(list: NameList, file?: string): string[] {
  const errors: string[] = [];
  const at = list?.id ?? file ?? "?";
  const err = (s: string) => errors.push(`${at}: ${s}`);
  if (!list || typeof list !== "object") return [`${at}: not an object`];
  for (const k of Object.keys(list)) if (!KEYS.includes(k)) err(`unknown field "${k}"`);
  if (typeof list.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(list.id)) err("id must be kebab-case");
  if (file && list.id !== file.replace(/\.json$/, "")) err(`id doesn't match its file name ${file}`);
  for (const k of ["noun", "nounPlural", "measure"] as const)
    if (typeof list[k] !== "string" || !list[k].trim()) err(`${k} is missing`);
    // Lower case, an acronym aside ("US state", as the round says "Texas is a US state").
    else if (list[k].split(" ").some((w) => w !== w.toLowerCase() && !/^[A-Z]{2,3}$/.test(w))) err(`${k} "${list[k]}" must be lower case`);
  if (list.scoring !== "ratio" && list.scoring !== "steps") err(`scoring must be "ratio" or "steps"`);
  if (!list.source || typeof list.source.title !== "string" || !list.source.title) err("source.title is missing");
  if (!list.source || typeof list.source.url !== "string" || !list.source.url.startsWith("https://"))
    err("source.url must be https");
  if (typeof list.asOf !== "string" || !/^\d{4}(-\d{2}-\d{2})?$/.test(list.asOf)) err("asOf must be YYYY-MM-DD or a year");
  if (!Array.isArray(list.entries) || list.entries.length < 20) {
    err("entries must be an array of at least 20");
    return errors;
  }
  /** Each normalized name or alias, by the entry that has it: one owner each, or a typed answer is ambiguous. */
  const owner = new Map<string, string>();
  const names = new Set<string>();
  for (const e of list.entries) {
    const keys = Object.keys(e ?? {});
    if (keys.some((k) => !["name", "aliases", "value"].includes(k))) err(`${e?.name}: unknown field`);
    if (typeof e?.name !== "string" || !e.name.trim()) {
      err(`an entry has no name`);
      continue;
    }
    if (names.has(e.name)) {
      err(`two entries are called ${e.name}`);
      continue;
    }
    names.add(e.name);
    if (!Array.isArray(e.aliases) || e.aliases.some((a) => typeof a !== "string")) err(`${e.name}: aliases must be strings`);
    if (typeof e.value !== "number" || !Number.isFinite(e.value)) err(`${e.name}: value must be a finite number`);
    else if (list.scoring === "ratio" && e.value <= 0) err(`${e.name}: a ratio list's value must be positive`);
    else if (list.scoring === "steps" && (e.value < 0 || !Number.isInteger(e.value)))
      err(`${e.name}: a steps list's value must be a whole number, 0 or more`);
    for (const form of [e.name, ...(e.aliases ?? [])]) {
      const n = normalize(form);
      if (!n) {
        err(`${e.name}: "${form}" is empty once normalized`);
        continue;
      }
      const prior = owner.get(n);
      if (prior === undefined) owner.set(n, e.name);
      else if (prior === e.name) err(`${e.name}: "${form}" repeats one of its own forms`);
      else err(`"${form}" is a name or alias of both ${prior} and ${e.name}`);
    }
  }
  // Names known without a figure: never an entry's form or another's, never a place of its own, and `partOf` an entry.
  if (list.unmeasured !== undefined && !Array.isArray(list.unmeasured)) err("unmeasured must be an array");
  const known = new Set<string>();
  for (const k of Array.isArray(list.unmeasured) ? list.unmeasured : []) {
    if (Object.keys(k ?? {}).some((key) => !["name", "aliases", "partOf"].includes(key))) err(`unmeasured ${k?.name}: unknown field`);
    if (typeof k?.name !== "string" || !k.name.trim()) {
      err("an unmeasured name is empty");
      continue;
    }
    if (known.has(k.name)) err(`two unmeasured names are ${k.name}`);
    known.add(k.name);
    if (!Array.isArray(k.aliases) || k.aliases.some((a) => typeof a !== "string")) err(`unmeasured ${k.name}: aliases must be strings`);
    if (k.partOf !== undefined && !names.has(k.partOf)) err(`unmeasured ${k.name}: partOf ${k.partOf} is no entry`);
    if (isPlace(k.name)) err(`unmeasured ${k.name} is a place of its own (fathom-name.ts PLACES)`);
    for (const form of [k.name, ...(k.aliases ?? [])]) {
      const n = normalize(form);
      if (!n) {
        err(`unmeasured ${k.name}: "${form}" is empty once normalized`);
        continue;
      }
      const prior = owner.get(n);
      if (prior === undefined) owner.set(n, `unmeasured ${k.name}`);
      else err(`"${form}" is a form of both ${prior} and unmeasured ${k.name}`);
    }
  }
  return errors;
}

/** The country lists must name the same countries, so every round has the same set to pick from. */
export function checkCountryLists(lists: NameList[]): string[] {
  return checkOneSet(lists, "country", "countries");
}

/** The US state lists likewise: the same 50 states in each. */
export function checkStateLists(lists: NameList[]): string[] {
  return checkOneSet(lists, STATE_NOUN.noun, STATE_NOUN.nounPlural);
}

/** Lists of one kind of thing name the same things, so a name means the same in every round of that kind. */
function checkOneSet(lists: NameList[], noun: string, nounPlural: string): string[] {
  const errors: string[] = [];
  const [first, ...rest] = lists;
  const names = (l: NameList) => new Set(l.entries.map((e) => e.name));
  const base = names(first);
  for (const l of rest) {
    const other = names(l);
    const missing = [...base].filter((n) => !other.has(n));
    const extra = [...other].filter((n) => !base.has(n));
    if (missing.length) errors.push(`${l.id} lacks ${missing.length} of ${first.id}'s ${nounPlural}: ${missing.slice(0, 8).join(", ")}`);
    if (extra.length) errors.push(`${l.id} has ${extra.length} ${nounPlural} ${first.id} lacks: ${extra.slice(0, 8).join(", ")}`);
  }
  for (const l of lists) if (l.noun !== noun || l.nounPlural !== nounPlural) errors.push(`${l.id}: noun must be ${noun}`);
  return errors;
}

export function loadLists(): { file: string; list: NameList }[] {
  return readdirSync(LISTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, list: JSON.parse(readFileSync(join(LISTS_DIR, file), "utf8")) as NameList }));
}

// ---------------------------------------------------------------------------------------------------------------
// Building the lists

function puzzle(id: string): Puzzle {
  return JSON.parse(readFileSync(join(PUZZLES, `${id}.json`), "utf8")) as Puzzle;
}

const all = (p: Puzzle): Entry[] => [...p.answers, ...p.extras];

/** "Wikipedia: List of ..." as the page title. */
const pageTitle = (p: Puzzle) => p.source.name.replace(/^Wikipedia:\s*/, "");

/**
 * The pipeline's current forms and junk, which a puzzle built before them lacks (docs/REBUILD_QUEUE.md: "St Lucia"
 * and "Antigua" from Nov 5, the city and country junk the judges found): the everyday forms of a country or city
 * (intent.ts) join the one entry they name, as build.ts gives them, and junk and blocked aliases go.
 */
function currentForms<E extends { name: string; aliases: string[] }>(entries: E[], kind: "countries" | "cities"): E[] {
  const junk = new Set((kind === "countries" ? COUNTRY_JUNK : CITY_JUNK).map(normalize));
  const added = new Map<E, string[]>();
  for (const line of kind === "countries" ? COUNTRY_FORMS : CITY_FORMS) {
    const set = new Set(line.map(normalize));
    // A city's usual name first: "Frisco" is a Texas city of its own, not San Francisco.
    let hits = kind === "cities" ? entries.filter((e) => normalize(e.name) === normalize(line[0])) : [];
    if (!hits.length) hits = entries.filter((e) => set.has(normalize(e.name)));
    if (!hits.length && kind === "countries") hits = entries.filter((e) => e.aliases.some((a) => set.has(normalize(a))));
    if (hits.length === 1) added.set(hits[0], [...(added.get(hits[0]) ?? []), ...line]);
  }
  return entries.map((e) => ({
    ...e,
    aliases: [...e.aliases, ...(added.get(e) ?? [])].filter((a) => !junk.has(normalize(a)) && !blockedAlias(a, [e.name])),
  }));
}

/**
 * Forms the round needs that the puzzles don't give (a judge typed about 50 answers on each name-it question, Nov 8):
 * old names and common misspellings, by the entry's name.
 */
export const FORMS: Record<string, string[]> = {
  Libya: ["Lybia"],
  Belarus: ["Byelorussia"],
  Cambodia: ["Kampuchea"],
  Kyrgyzstan: ["Kirghizia"],
  Laos: ["Lao"],
  Djibouti: ["Jibuti"],
  India: ["Hindustan"],
  "Bosnia and Herzegovina": ["BiH"],
  Hungary: ["Magyarország"],
  Dhaka: ["Dakha"],
  London: ["Greater London"],
  "Mexico City": ["Mex City"],
  Hawaii: ["Hawaiʻi"],
  // Renamed in 2023; the agglomerations page still writes the old name.
  Aurangabad: ["Chhatrapati Sambhajinagar"],
};

/** Forms a puzzle gives an entry that name something else: "The land of ten-thousand lakes" is Minnesota, not Michigan. */
export const WRONG_FORMS: Record<string, string[]> = {
  Michigan: ["The land of ten-thousand lakes"],
};

/**
 * Redirects some puzzles carry that are no name anyone types for the thing (a sport, a cyclone, a nickname for its
 * capital): left out of the round's lists, where a stray word in one could read as that country.
 */
export const NOT_A_NAME =
  /\b(?:sports?|games|athletes|boxing|cyclone|independence|occupation|english|standing|mandates|colony|heart of|capital|largest city)\b|\bterritory,/i;

/**
 * Whether a form is a place of its own (fathom-name.ts PLACES: "England", "Northern Ireland", "Tasmania"), never an
 * alias: "England" on the United Kingdom locked the whole UK; the round says "England is part of the UK." instead.
 */
export const isPlace = (form: string): boolean => !!placeNamed(form) || PART_WORDS.has(normalize(form));

/** The people of a part of a country, never the country: "Scottish" and "Welsh" locked the UK as "Scotland" did. */
const PART_WORDS = new Set(["English", "Scottish", "Scots", "Welsh", "Northern Irish"].map(normalize));

/**
 * Whether a place of its own is one of the list's own things: on a list of US states, "New York State" (a US state in
 * PLACES) is New York, the entry, and must lock as it. On any other list it is a place of its own, never an alias.
 */
export const ownKind = (form: string, noun: string | undefined): boolean =>
  !!noun && normalize(placeNamed(form)?.noun ?? "") === normalize(noun);

/**
 * The forms a list keeps for an entry: its own and FORMS, less places of their own (but a place of the list's own kind,
 * `noun`) and redirects that aren't names.
 */
export function keptForms(name: string, aliases: string[], noun?: string): string[] {
  const wrong = new Set((WRONG_FORMS[name] ?? []).map(normalize));
  return [...aliases, ...(FORMS[name] ?? [])].filter(
    (a) => (!isPlace(a) || ownKind(a, noun)) && !NOT_A_NAME.test(a) && !wrong.has(normalize(a)),
  );
}

/**
 * An entry's aliases with every form another entry also has dropped (an alias two countries share would make a
 * typed answer ambiguous; neither gets it), and the forms that only repeat its own name.
 */
function uniqueForms(given: { name: string; aliases: string[]; value: number }[], noun?: string): NameEntry[] {
  const entries = given.map((e) => ({ ...e, aliases: keptForms(e.name, e.aliases, noun) }));
  const count = new Map<string, number>();
  for (const e of entries)
    for (const f of new Set([e.name, ...e.aliases].map(normalize).filter(Boolean))) count.set(f, (count.get(f) ?? 0) + 1);
  const dropped: string[] = [];
  const out = entries.map((e) => {
    const seen = new Set([normalize(e.name)]);
    const aliases: string[] = [];
    for (const a of e.aliases) {
      const n = normalize(a);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      if ((count.get(n) ?? 0) > 1) {
        dropped.push(`${a} (${e.name})`);
        continue;
      }
      aliases.push(a);
    }
    return { name: e.name, aliases, value: e.value };
  });
  if (dropped.length) console.log(`  dropped ${dropped.length} shared aliases: ${dropped.join(", ")}`);
  for (const e of out) if ((count.get(normalize(e.name)) ?? 0) > 1) throw new Error(`${e.name} is another entry's alias too`);
  return out;
}

/** Rows of the land border table that are no sovereign country, or a second row for one. */
const BORDER_ROWS_SKIPPED = [
  // Territories and parts of a country.
  /^Azores/, /^Madeira/, /^Hong Kong/, /^Macau/, /^Saint Pierre and Miquelon/, /^South Ossetia/, /^Western Sahara/,
  // The kingdoms' other rows: Denmark, the Netherlands and the United Kingdom are counted as the countries the
  // population and area lists count (Greenland, Aruba or Gibraltar is its own row there). France's own row counts
  // the whole French Republic, overseas regions included (French Guiana borders Brazil and Suriname), not
  // metropolitan France alone.
  /^Denmark, Kingdom of/, /^Netherlands, Kingdom of/, /^United Kingdom \(plus/, /^France, Metropolitan/,
];

/** How the border table writes a country the population list names otherwise. */
const BORDER_NAMES: Record<string, string> = {
  "Denmark (constituent country)": "Denmark",
  "Netherlands (constituent country)": "Netherlands",
};

interface BorderRow {
  country: string;
  neighbours: number;
}

async function borderRows(title: string): Promise<BorderRow[]> {
  const $ = await fetchPage(title);
  const table = wikitables($)[0];
  const { header, body } = splitHeader(tableGrid($, table));
  const col = header.findIndex((h) => /distinct land neighbours/i.test(h));
  if (col < 0) throw new Error(`no "distinct land neighbours" column on ${title}: ${header.join(" | ")}`);
  const rows: BorderRow[] = [];
  for (const row of body) {
    const text = row[0]?.text ?? "";
    if (BORDER_ROWS_SKIPPED.some((re) => re.test(text))) continue;
    const country = BORDER_NAMES[text] ?? row[0]?.link ?? text;
    const neighbours = Number((row[col]?.text ?? "").replace(/[^\d]/g, ""));
    if (!/^\d+$/.test((row[col]?.text ?? "").trim())) throw new Error(`${text}: neighbours "${row[col]?.text}"`);
    rows.push({ country: country.replace(/\s*→includes:.*$/, ""), neighbours });
  }
  return rows;
}

/** Unranked rows of the area table (Taiwan, Kosovo), by link title: their total area in km². */
async function areaRows(title: string): Promise<Map<string, number>> {
  const $ = await fetchPage(title);
  const { header, body } = splitHeader(tableGrid($, wikitables($)[0]));
  const name = header.findIndex((h) => /country/i.test(h));
  const total = header.findIndex((h) => /^total/i.test(h));
  const out = new Map<string, number>();
  for (const row of body) {
    const link = row[name]?.link;
    const m = (row[total]?.text ?? "").match(/^([\d,.]+)/);
    if (link && m && !out.has(link)) out.set(link, Number(m[1].replace(/,/g, "")));
  }
  return out;
}

/**
 * The density table's rows (Nov 17): each country's people per square kilometre of land, by the country its
 * "Demographics of ..." link names ("Demographics of Republic of the Congo"), its rows for dependencies included.
 */
async function densityRows(title: string): Promise<{ country: string; density: number }[]> {
  const $ = await fetchPage(title);
  const { header, body } = splitHeader(tableGrid($, wikitables($)[0]));
  const col = header.findIndex((h) => /density.*km/i.test(h));
  if (col < 0) throw new Error(`no density column on ${title}: ${header.join(" | ")}`);
  const rows: { country: string; density: number }[] = [];
  for (const row of body) {
    const text = row[0]?.text ?? "";
    if (text === "World") continue;
    const density = Number((row[col]?.text ?? "").replace(/,/g, ""));
    if (!Number.isFinite(density) || density <= 0) throw new Error(`${text}: density "${row[col]?.text}"`);
    const country = (row[0]?.link ?? text).replace(/^Demographics of (?:the )?/, "");
    rows.push({ country, density });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// The city list (Nov 17)

/**
 * The city list's figures: every urban agglomeration of 1 million people or more, by one definition (a central city
 * and the places continuously built up around it, as one area) projected to one date. Wikipedia has no such table any
 * more ("List of urban areas by population" now redirects to "List of largest cities", 85 rows of 5 million and up,
 * the old list's source), and the Demographia report that page cites for its urban areas can't be fetched safely here
 * (its certificate has expired). The page allows its figures to be used with this reference and link, which the
 * reveal shows.
 */
export const AGGLOMERATIONS = {
  title: "Thomas Brinkhoff: Major Agglomerations of the World",
  url: "https://www.citypopulation.de/en/world/agglomerations/",
};

/** One row of the agglomerations table. */
export interface AgglomerationRow {
  /** The name as the page writes it locally ("Guăngzhōu") and in English ("Canton"). */
  local: string;
  english: string;
  /** Its Wikipedia article, when the page links one ("Guangzhou"). */
  wiki?: string;
  country: string;
  population: number;
  /** The places the page counts in it ("incl. Dōngguān, Fóshān, ..."), each with its country when the page names one. */
  includes: { names: string[]; country?: string }[];
}

const CACHE = join(ROOT, ".cache", "wiki");
const USER_AGENT = "TopTensPuzzleBuilder/0.1 (hobby trivia game)";

/** A page that isn't Wikipedia's: cached in .cache/wiki by its URL as wiki.ts caches pages, and fetched once if not. */
async function fetchUrl(url: string): Promise<string> {
  const file = join(CACHE, createHash("sha1").update(url).digest("hex") + ".html");
  if (existsSync(file)) return readFileSync(file, "utf8");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const body = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, body);
  return body;
}

/**
 * Marks the page leaves in a name ("Erbil" with a left-to-right mark, "Rostov]-na-Donu", "Newcastle[upon Tyne" for a
 * space), and runs of spaces.
 */
const tidy = (s: string) =>
  clean(s)
    .replace(/(\p{L})\[(\p{L})/gu, "$1 $2")
    .replace(/[[\]]/g, "")
    .trim();
const clean = (s: string) => s.replace(/[\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}]/gu, "").replace(/\s+/g, " ").trim();

/** The agglomerations page's table and its reference date ("2026-01-01"). */
export function agglomerationRows(html: string): { rows: AgglomerationRow[]; asOf: string } {
  const $ = cheerio.load(html);
  const asOf = $("body").text().match(/reference date:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!asOf) throw new Error("agglomerations: no reference date on the page");
  const table = $("table.data").first();
  const header = table.find("tr").first().text().replace(/\s+/g, "");
  if (header !== "RankNameEnglishNameCountryPopulationStatusRemark") throw new Error(`agglomerations: a new table layout (${header})`);
  const cells: string[][] = [];
  const wiki: (string | undefined)[] = [];
  table.find("tr").each((_, tr) => {
    const td = $(tr).find("td");
    if (!td.length) return;
    if (td.length !== 7) throw new Error(`agglomerations: a row of ${td.length} cells`);
    cells.push(td.map((_, c) => $(c).text()).get());
    wiki.push(td.eq(1).attr("data-wiki") || undefined);
  });
  const countries = new Set(cells.map((c) => tidy(c[3])));
  const rows = cells.map((c, i): AgglomerationRow => {
    const population = Number(c[4].replace(/[^\d]/g, ""));
    if (!(population >= 1e6)) throw new Error(`agglomerations: ${c[2]} has ${c[4]}`);
    const incl = clean(c[6]).match(/\bincl\.\s*(.+)$/)?.[1] ?? "";
    const includes = incl
      .split(/,\s*/)
      .filter(Boolean)
      .map((part) => {
        // "Al-Jīzah [Giza]": two names. "Windsor (Canada)": a place in another country. "New Taipei City (Xinbei)": two.
        const paren = part.match(/\(([^)]+)\)/)?.[1]?.trim();
        const alt = part.match(/\[([^\]]+)\]/)?.[1]?.trim();
        const base = clean(part.replace(/\([^)]*\)|\[[^\]]*\]/g, ""));
        const country = paren && countries.has(paren) ? paren : undefined;
        const names = [base, ...(alt ? [alt] : []), ...(paren && !country ? [paren] : [])];
        return { names: [...names, ...names.filter((n) => PART_NAMES[n]).map((n) => PART_NAMES[n])], ...(country && { country }) };
      });
    return { local: tidy(c[1]), english: tidy(c[2]), ...(wiki[i] && { wiki: tidy(wiki[i]!) }), country: tidy(c[3]), population, includes };
  });
  return { rows, asOf };
}

/** A city on one of TENtacle's city lists. */
export interface PoolCity {
  pool: string;
  name: string;
  aliases: string[];
  /** On a regional list, a city outside its region ("Tokyo isn't in Europe."): a city of anywhere, as on a world list. */
  elsewhere?: boolean;
}

/**
 * TENtacle's city lists, the world's first: every city named on them, and every alias, is one the city round knows
 * (Nov 17: a real city never reads as "not one of our cities"), measured or not.
 */
export const CITY_POOLS = [
  "world-cities", "capitals", "city-visitors", "metro-cities", "skyscraper-cities", "billionaire-cities", "europe-cities",
  "africa-cities", "us-cities", "canada-cities", "brazil-cities", "china-cities", "india-cities", "australia-cities",
];

/** The countries of Europe and of Africa as the agglomerations page writes them. */
const EUROPE = new Set([
  "Armenia", "Austria", "Azerbaijan", "Belarus", "Belgium", "Bulgaria", "Czech Republic", "Denmark", "Finland", "France",
  "Georgia", "Germany", "Great Britain", "Greece", "Hungary", "Ireland", "Italy", "Netherlands", "Norway", "Poland",
  "Portugal", "Romania", "Russia", "Serbia", "Spain", "Sweden", "Switzerland", "Turkey", "Ukraine",
]);
const AFRICA = new Set([
  "Algeria", "Angola", "Benin", "Burkina Faso", "Burundi", "Cameroon", "Central African Republic", "Chad",
  "Congo (Dem. Rep.)", "Congo (Rep.)", "Egypt", "Eritrea", "Ethiopia", "Gambia", "Ghana", "Guinea", "Ivory Coast", "Kenya",
  "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Morocco", "Mozambique", "Niger", "Nigeria", "Rwanda",
  "Senegal", "Sierra Leone", "Somalia", "South Africa", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia",
  "Zimbabwe",
]);

/** The city lists of one region, by the countries (as the page writes them) whose cities they hold. */
const REGION_POOLS: Record<string, (country: string) => boolean> = {
  "europe-cities": (c) => EUROPE.has(c),
  "africa-cities": (c) => AFRICA.has(c),
  "us-cities": (c) => c === "United States of America",
  "canada-cities": (c) => c === "Canada",
  "brazil-cities": (c) => c === "Brazil",
  "china-cities": (c) => c === "China",
  "india-cities": (c) => c === "India",
  "australia-cities": (c) => c === "Australia",
};

/**
 * Agglomerations named on their own (by the page's English name and country, or its article), never as a city of the
 * lists by their bare name: the smaller of two rows that share a name (the better known keeps it: Valencia is Spain's),
 * and two cities of one name in one country.
 */
export const CITY_NAMES: Record<string, { name: string; aliases?: string[]; shared?: true }> = {
  "Hyderabad|Pakistan": { name: "Hyderabad, Pakistan", aliases: ["Hyderabad, Sindh"] },
  "Melbourne|United States of America": { name: "Melbourne, Florida" },
  "Valencia|Venezuela": { name: "Valencia, Venezuela", aliases: ["Valencia, Carabobo"] },
  // Two of a name: neither takes "Taizhou" alone (it offers both), and it is no name without a figure either.
  "Taizhou, Zhejiang": { name: "Taizhou, Zhejiang", shared: true },
  "Taizhou, Jiangsu": { name: "Taizhou, Jiangsu", shared: true },
  // Suzhou is Jiangsu's, which the page counts in Shanghai's urban area.
  "Suzhou, Anhui": { name: "Suzhou, Anhui" },
};

/**
 * The places the page counts in an agglomeration under another name than the lists' ("incl. Haora" is Howrah, "Kalyan"
 * Kalyan-Dombivli), and a city's new name a list has (Aurangabad has been Chhatrapati Sambhajinagar since 2023).
 */
const PART_NAMES: Record<string, string> = {
  Haora: "Howrah",
  Kalyan: "Kalyan-Dombivli",
  "East Rand": "Ekurhuleni",
  "Shubrā al-Khaymah": "Shubra el-Kheima",
};
const ownName = (r: AgglomerationRow) => CITY_NAMES[`${r.english}|${r.country}`] ?? (r.wiki ? CITY_NAMES[r.wiki] : undefined);

/** The page's English names that aren't the name the city goes by (and the lists may know it by). */
const ENGLISH_NAMES: Record<string, string> = {
  "Rhine-Ruhr Area": "Rhine-Ruhr",
  "Aix-la-Chapelle": "Aachen",
  "Santa Cruz": "Santa Cruz de la Sierra",
  "Frankfurt am Main": "Frankfurt",
};

/**
 * Entries whose figure takes in far more than the city its name says, shown with what they count, the bare name kept
 * as an alias: the page's Guangzhou is the whole Pearl River Delta (Shenzhen, Dongguan and Foshan in it) at 73.6
 * million, which read as a mistake beside Shanghai's 42 million (Nov 19). The places in it say "counted as part of"
 * the shown name.
 */
export const SHOWN_AS: Record<string, string> = { Guangzhou: "Guangzhou (Pearl River Delta)" };

/** A romanization's marks ("Kermānshāh", "Zhōukŏu"): a name shown as its article writes it ("Kermanshah"), if it has one. */
const ROMANIZED = /[āēīōūǎěǐǒǔăĕĭŏŭṣḥṭẓḍṇṛṃ]/i;

/**
 * Places an agglomeration takes in that share their name with places elsewhere ("Springfield" is in Hartford's, but
 * which Springfield?): never "counted as part of" it, only names without a figure.
 */
const SHARED_PART_NAMES = new Set(["Springfield", "Concord", "Hamilton", "Windsor", "Norfolk", "Victoria", "Salem", "Richmond"].map(normalize));

/** Aliases that name a city's metro system, not the city ("Barcelona Metro", from the metro systems list). */
export const METRO_SYSTEM = /\s(?:Metro|Subway|MRT|Metro System|Metrorail|U-Bahn|Underground|Rail Transit)$/i;

function cityPools(): PoolCity[] {
  return CITY_POOLS.flatMap((pool) =>
    all(puzzle(pool)).map((e) => ({ pool, name: e.name, aliases: e.aliases, ...((e as { elsewhere?: boolean }).elsewhere && { elsewhere: true }) })),
  );
}

/** "León, Guanajuato" and "Chonburi (city)" as the names they are: "León", "Chonburi". */
const articleBase = (title: string) => tidy(title.replace(/\s*\([^)]*\)$/, "").replace(/,.*$/, ""));

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => void m.set(k, [...(m.get(k) ?? []), v]);

/**
 * The city list: each agglomeration with its figure, named and typed as the city lists name it (their names and
 * aliases, the page's local and English names, the forms people use: intent.ts), and every other city on those lists
 * as a name known without a figure (`unmeasured`): a city the page counts in an agglomeration says which (`partOf`).
 *
 * A row is a city of the lists by name: the world lists' (any country) or its own region's (europe-cities for a city in
 * Europe), by its name, its English name or its article, or by an alias only one city of a list carries. A world list's
 * city is never taken by a row in another region when a regional list has a city of that name there (the world lists'
 * Birmingham may be Alabama's). Bigger rows first: a city two rows could be is the bigger one's (Hyderabad, India).
 */
export function cityList({ rows, asOf }: { rows: AgglomerationRow[]; asOf: string }, pools: PoolCity[]): NameList {
  const byName = new Map<string, PoolCity[]>();
  const byAlias = new Map<string, PoolCity[]>();
  for (const c of pools) {
    push(byName, normalize(c.name), c);
    for (const a of new Set(c.aliases.map(normalize))) push(byAlias, a, c);
  }
  const regional = (c: PoolCity) => !!REGION_POOLS[c.pool] && !c.elsewhere;
  /** Whether a city of the lists can be one in `country`: a world list's, or a regional list's of that region. */
  const canBe = (c: PoolCity, country: string) => !regional(c) || REGION_POOLS[c.pool](country);
  /** The cities of a name a regional list has outside `country` (Birmingham, Alabama, for Birmingham, England). */
  const homonyms = (name: string, country: string) => (byName.get(normalize(name)) ?? []).filter((o) => regional(o) && !REGION_POOLS[o.pool](country));
  /** The names a row goes by: the page's and its article's, or for a row named on its own (CITY_NAMES) those alone. */
  const forms = (r: AgglomerationRow) => {
    const own = ownName(r);
    const names = own
      ? [own.name, ...(own.aliases ?? [])]
      : [r.english, r.local, ...(ENGLISH_NAMES[r.english] ? [ENGLISH_NAMES[r.english]] : []), ...(r.wiki ? [r.wiki, articleBase(r.wiki)] : [])];
    return [...new Set(names.map(normalize).filter(Boolean))];
  };

  const claimed = new Set<PoolCity>();
  const found = new Map<AgglomerationRow, PoolCity[]>();
  for (const r of [...rows].sort((a, b) => b.population - a.population)) {
    if (ownName(r)) {
      found.set(r, []);
      continue;
    }
    const open = (c: PoolCity) => !claimed.has(c) && canBe(c, r.country);
    let hits = forms(r).flatMap((f) => (byName.get(f) ?? []).filter(open));
    if (!hits.length) {
      // By an alias: one city's in each list that has it, and the same name in all of them.
      hits = forms(r).flatMap((f) => {
        const cs = (byAlias.get(f) ?? []).filter(open);
        const perPool = new Map<string, number>();
        for (const c of cs) perPool.set(c.pool, (perPool.get(c.pool) ?? 0) + 1);
        const one = [...perPool.values()].every((n) => n === 1) && new Set(cs.map((c) => normalize(c.name))).size === 1;
        return one ? cs : [];
      });
    }
    for (const c of hits) claimed.add(c);
    found.set(r, hits);
  }

  const order = (c: PoolCity) => CITY_POOLS.indexOf(c.pool);
  const named = new Map<AgglomerationRow, { name: string; aliases: string[] }>();
  for (const r of rows) {
    const own = ownName(r);
    const hits = [...found.get(r)!].sort((a, b) => order(a) - order(b));
    const english = ENGLISH_NAMES[r.english] ?? (ROMANIZED.test(r.english) && r.wiki ? articleBase(r.wiki) : r.english);
    const name = own?.name ?? hits[0]?.name ?? english;
    const given = own
      ? own.aliases ?? []
      : [...hits.flatMap((c) => [c.name, ...c.aliases]), english, r.english, r.local, ...(r.wiki ? [r.wiki, articleBase(r.wiki)] : [])];
    // A world list's city of a name a region's list has elsewhere may carry that one's forms too ("San Jose, California"
    // on Costa Rica's): those stay the other city's.
    const theirs = new Set(hits.flatMap((c) => homonyms(c.name, r.country)).flatMap((o) => o.aliases.map(normalize)));
    named.set(r, {
      name,
      aliases: [...new Set(given)].filter((a) => normalize(a) !== normalize(name) && !METRO_SYSTEM.test(a) && !theirs.has(normalize(a))),
    });
  }
  // An alias that is another row's name is that row's ("The Angeles" is Los Angeles's, but Angeles is a city of its own).
  const rowNames = new Set([...named.values()].map((n) => normalize(n.name)));
  const measured = uniqueForms(
    currentForms(
      rows.map((r) => ({ ...named.get(r)!, value: r.population })),
      "cities",
    ).map((e) => ({ ...e, aliases: e.aliases.filter((a) => !rowNames.has(normalize(a))) })),
  );
  const taken = new Set(measured.flatMap((e) => [e.name, ...e.aliases].map(normalize)));
  // Every name a row goes by is the row's, even one it shares (Taizhou is two cities; neither reads "not measured").
  for (const r of rows) for (const f of [...forms(r), ...(ownName(r)?.shared ? [normalize(r.english)] : [])]) taken.add(f);

  // The places an agglomeration takes in, when one of the lists has that city in that country: "counted in" it.
  const parts = new Map<PoolCity, { partOf: string; names: string[] }>();
  const twice = new Set<PoolCity>();
  for (const r of rows) {
    for (const inc of r.includes) {
      const country = inc.country ?? r.country;
      for (const n of inc.names.map(normalize)) {
        if (!n || SHARED_PART_NAMES.has(n)) continue;
        // By its name on a list, or by an alias of one city there ("Köln" is Cologne's).
        let cs = (byName.get(n) ?? []).filter((c) => !claimed.has(c));
        if (!cs.length) {
          const as = (byAlias.get(n) ?? []).filter((c) => !claimed.has(c));
          if (new Set(as.map((c) => normalize(c.name))).size === 1 && !taken.has(normalize(as[0].name))) cs = as;
        }
        // Its own region's list must have it, and no other region's; with no regional list, a world list, and no region.
        const home = cs.filter((c) => regional(c) && REGION_POOLS[c.pool](country));
        const elsewhere = cs.filter((c) => regional(c) && !REGION_POOLS[c.pool](country));
        const hasRegion = Object.values(REGION_POOLS).some((p) => p(country));
        const found = hasRegion ? home : elsewhere.length ? [] : cs;
        // A name a row goes by is that row's, unless a region's list has this one there (St. Petersburg, Florida).
        if (!found.length || elsewhere.length || (taken.has(n) && !home.length)) continue;
        for (const city of found) {
          if (parts.has(city) && parts.get(city)!.partOf !== named.get(r)!.name) twice.add(city);
          parts.set(city, { partOf: named.get(r)!.name, names: inc.names });
        }
        break;
      }
    }
  }
  for (const c of twice) parts.delete(c);
  const partOf = (cs: PoolCity[]) => cs.map((c) => parts.get(c)).find(Boolean);

  // Every other city of the lists: known, with no figure. One entry a name, its aliases from every list that has it. A
  // city whose name a row goes by (Birmingham, Alabama) goes by its own longer name, if a list gives it one.
  const known = new Map<string, { name: string; aliases: string[]; partOf?: string }>();
  for (const c of [...pools].sort((a, b) => order(a) - order(b))) {
    const n = normalize(c.name);
    if (claimed.has(c) || isPlace(c.name)) continue;
    const own = taken.has(n) ? c.aliases.filter((a) => !taken.has(normalize(a)) && !isPlace(a)) : undefined;
    const name = own ? own.find((a) => a.includes(", ")) : c.name;
    if (!name) continue;
    const part = own ? partOf([c]) : partOf(byName.get(n) ?? []);
    const key = normalize(name);
    const k = known.get(key) ?? { name, aliases: [], ...(part && { partOf: part.partOf }) };
    k.aliases.push(...(own ?? c.aliases), ...(part && !own ? part.names : []));
    known.set(key, k);
  }
  const owner = new Map<string, number>();
  const kept = [...known.values()].map((k) => {
    const aliases = currentForms([{ name: k.name, aliases: keptForms(k.name, k.aliases, "city") }], "cities")[0].aliases;
    return {
      ...k,
      aliases: [...new Set(aliases)].filter(
        (a) => !taken.has(normalize(a)) && !known.has(normalize(a)) && normalize(a) !== normalize(k.name) && !METRO_SYSTEM.test(a),
      ),
    };
  });
  for (const k of kept) for (const f of new Set(k.aliases.map(normalize))) owner.set(f, (owner.get(f) ?? 0) + 1);
  const unmeasured = kept.map((k) => {
    const seen = new Set<string>();
    const aliases = k.aliases.filter((a) => {
      const f = normalize(a);
      if (!f || seen.has(f) || owner.get(f)! > 1) return false;
      seen.add(f);
      return true;
    });
    return { name: k.name, aliases, ...(k.partOf && { partOf: k.partOf }) };
  });

  return {
    id: "cities-population",
    noun: "city",
    nounPlural: "cities",
    measure: "people",
    scoring: "ratio",
    source: AGGLOMERATIONS,
    asOf,
    entries: measured.map((e) => (SHOWN_AS[e.name] ? { ...e, name: SHOWN_AS[e.name], aliases: [e.name, ...e.aliases] } : e)),
    unmeasured: unmeasured.map((k) => (k.partOf && SHOWN_AS[k.partOf] ? { ...k, partOf: SHOWN_AS[k.partOf] } : k)),
  };
}

/** The list ids named on the command line (`lists.ts us-states-population`): only those are written; none, all. */
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("-"));

function write(list: NameList) {
  if (ONLY.length && !ONLY.includes(list.id)) return;
  mkdirSync(LISTS_DIR, { recursive: true });
  const errors = checkList(list);
  if (errors.length) throw new Error(errors.join("\n"));
  const values = list.entries.map((e) => e.value);
  console.log(
    `${list.id}: ${list.entries.length} ${list.nounPlural}, ${list.measure} ${Math.min(...values)} to ${Math.max(...values)}`,
  );
  writeFileSync(join(LISTS_DIR, `${list.id}.json`), JSON.stringify(list, null, 2) + "\n");
}

/** The four country lists, which share one set of countries and one set of forms. */
async function countryLists() {
  const population = puzzle("countries-population");
  const area = puzzle("countries-area");

  // One country set: the sovereign countries of the land border table (193 UN members, the Vatican, Palestine,
  // Taiwan and Kosovo), named as the population list names them.
  const byForm = new Map<string, Entry>();
  for (const e of all(population))
    for (const f of [e.name, ...e.aliases]) if (!byForm.has(normalize(f))) byForm.set(normalize(f), e);
  for (const e of all(population)) byForm.set(normalize(e.name), e);
  const bordersTitle = "List of countries and territories by land borders";
  const borders = new Map<string, number>();
  for (const row of await borderRows(bordersTitle)) {
    const plain = row.country.replace(/\s*\(.*\)$/, "");
    const e = byForm.get(normalize(row.country)) ?? byForm.get(normalize(plain));
    if (!e) throw new Error(`land borders: no country in countries-population for "${row.country}"`);
    if (borders.has(e.name)) throw new Error(`land borders: two rows for ${e.name}`);
    borders.set(e.name, row.neighbours);
  }
  if (borders.size !== 197) throw new Error(`expected 197 countries (193 + Vatican City, Palestine, Taiwan, Kosovo), got ${borders.size}`);
  const countries = all(population).filter((e) => borders.has(e.name));

  // Each country's forms: the population list's, plus the area list's for the same country (one identity everywhere).
  const areaByName = new Map(all(area).map((e) => [e.name, e]));
  const areaByForm = new Map<string, Entry>();
  for (const e of all(area)) for (const f of [e.name, ...e.aliases]) if (!areaByForm.has(normalize(f))) areaByForm.set(normalize(f), e);
  const areaOf = (c: Entry): Entry => {
    const e = areaByName.get(c.name) ?? [c.name, ...c.aliases].map((f) => areaByForm.get(normalize(f))).find(Boolean);
    if (!e) throw new Error(`countries-area has no ${c.name}`);
    return e;
  };
  const areaTitle = pageTitle(area);
  const unranked = await areaRows(areaTitle);
  const forms = new Map(
    currentForms(
      countries.map((c) => ({ name: c.name, aliases: [...new Set([...c.aliases, ...areaOf(c).aliases])] })),
      "countries",
    ).map((c) => [c.name, c.aliases] as const),
  );
  const country = (c: Entry, value: number) => ({ name: c.name, aliases: forms.get(c.name)!, value });

  const missing = (what: string) => (c: Entry) => {
    throw new Error(`${what}: no figure for ${c.name}`);
  };
  write({
    id: "countries-population",
    noun: "country",
    nounPlural: "countries",
    measure: "people",
    scoring: "ratio",
    source: { title: pageTitle(population), url: population.source.url },
    asOf: population.source.dataAsOf ?? population.source.asOf,
    entries: uniqueForms(countries.map((c) => country(c, c.n ?? missing("population")(c)))),
  });

  write({
    id: "countries-area",
    noun: "country",
    nounPlural: "countries",
    measure: "square kilometres",
    scoring: "ratio",
    source: { title: areaTitle, url: area.source.url },
    asOf: area.source.dataAsOf ?? area.source.asOf,
    entries: uniqueForms(
      countries.map((c) => {
        const a = areaOf(c);
        // Taiwan and Kosovo are unranked rows of the same table: their figure is read from it.
        const n = a.n ?? unranked.get(a.article ?? a.name) ?? unranked.get(a.name);
        return country(c, n ?? missing("area")(c));
      }),
    ),
  });

  write({
    id: "land-borders",
    noun: "country",
    nounPlural: "countries",
    measure: "land borders",
    scoring: "steps",
    source: { title: bordersTitle, url: pageUrl(bordersTitle) },
    asOf: new Date().toISOString().slice(0, 10),
    entries: uniqueForms(countries.map((c) => country(c, borders.get(c.name)!))),
  });

  // People per square kilometre of land (Nov 17: "Name a country with about 100 people per square kilometre", worked
  // out from a population and an area you know): the density table's own figures, its rows for dependencies left out.
  const densityTitle = "List of countries and dependencies by population density";
  const writtenForms = new Map(
    (JSON.parse(readFileSync(join(LISTS_DIR, "countries-population.json"), "utf8")) as NameList).entries.map((e) => [e.name, e.aliases] as const),
  );
  const density = new Map<string, number>();
  for (const row of await densityRows(densityTitle)) {
    const plain = row.country.replace(/\s*\(.*\)$/, "");
    const e = byForm.get(normalize(row.country)) ?? byForm.get(normalize(plain));
    if (!e || !borders.has(e.name)) continue;
    if (density.has(e.name)) throw new Error(`density: two rows for ${e.name}`);
    density.set(e.name, row.density);
  }
  write({
    id: "countries-density",
    noun: "country",
    nounPlural: "countries",
    measure: "people per square kilometre",
    scoring: "ratio",
    source: { title: densityTitle, url: pageUrl(densityTitle) },
    asOf: new Date().toISOString().slice(0, 10),
    // Its forms are the population list's as written (just now, or as committed when only this list is built), so the
    // country lists keep one set of forms even when the puzzles' redirects have moved on since.
    entries: uniqueForms(countries.map((c) => ({ name: c.name, aliases: writtenForms.get(c.name) ?? forms.get(c.name)!, value: density.get(c.name) ?? missing("density")(c) }))),
  });
}

/**
 * Every urban agglomeration of 1 million or more, by one source and one measure (Nov 17: "i guessed rome for a city
 * based question but it wasnt accepted"), named and typed as TENtacle's city lists name them; every other city on those
 * lists is a name the round knows without a figure.
 */
async function cityLists() {
  write(cityList(agglomerationRows(await fetchUrl(AGGLOMERATIONS.url)), cityPools()));
}

/**
 * The 50 US states (Nov 17), from the two state puzzles: one set of states and one set of forms in both lists, the
 * puzzles' own (postal codes, "Calif.", "New York State"), less what isn't a name.
 */
function stateLists() {
  const missing = (what: string) => (c: Entry) => {
    throw new Error(`${what}: no figure for ${c.name}`);
  };
  const statePop = puzzle("us-states-population");
  const stateArea = puzzle("us-states-area");
  const areaByState = new Map(all(stateArea).map((e) => [e.name, e]));
  const states = all(statePop).filter((e) => e.n !== undefined);
  if (states.length !== 50) throw new Error(`expected the 50 US states, got ${states.length}`);
  const stateForms = (e: Entry) => [...new Set([...e.aliases, ...(areaByState.get(e.name)?.aliases ?? [])])];
  const areaOfState = (e: Entry) => areaByState.get(e.name)?.n ?? missing("US state area")(e);
  write({
    id: "us-states-population",
    ...STATE_NOUN,
    measure: "people",
    scoring: "ratio",
    source: { title: pageTitle(statePop), url: statePop.source.url },
    asOf: statePop.source.dataAsOf ?? statePop.source.asOf,
    entries: uniqueForms(states.map((e) => ({ name: e.name, aliases: stateForms(e), value: e.n! })), STATE_NOUN.noun),
  });
  write({
    id: "us-states-area",
    ...STATE_NOUN,
    measure: "square kilometres",
    scoring: "ratio",
    source: { title: pageTitle(stateArea), url: stateArea.source.url },
    asOf: stateArea.source.dataAsOf ?? stateArea.source.asOf,
    entries: uniqueForms(states.map((e) => ({ name: e.name, aliases: stateForms(e), value: areaOfState(e) })), STATE_NOUN.noun),
  });
}

/** The lists named on the command line (each group only when one of its lists is), then the checks across lists. */
async function main() {
  const wanted = (ids: string[]) => !ONLY.length || ids.some((id) => ONLY.includes(id));
  if (wanted(COUNTRY_LISTS)) await countryLists();
  if (wanted(["cities-population"])) await cityLists();
  if (wanted(STATE_LISTS)) stateLists();
  const read = (id: string) => JSON.parse(readFileSync(join(LISTS_DIR, `${id}.json`), "utf8")) as NameList;
  const errors = [...checkCountryLists(COUNTRY_LISTS.map(read)), ...checkStateLists(STATE_LISTS.map(read))];
  if (errors.length) throw new Error(errors.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
