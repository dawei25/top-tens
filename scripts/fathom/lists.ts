// Name-it lists for Fathom's name-it round ("Name a country with about 50 million people"): every thing of a kind
// with its figure, so any fair answer registers. Written to public/fathom/lists/<id>.json.
//   NODE_NO_WARNINGS=1 NODE_USE_ENV_PROXY=1 npx tsx scripts/fathom/lists.ts
// Reads the built puzzles and two Wikipedia pages (cached in .cache/wiki; fetched politely through wiki.ts if not).
// The checks every file must pass (shape, no shared names or aliases, one set of countries) are `checkList` and
// `checkCountryLists`, run on the committed files by lists.test.ts.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
}

/** The country lists, which share one set of countries (by name) so a country means the same in every round. */
export const COUNTRY_LISTS = ["countries-population", "countries-area", "land-borders", "countries-density"];
/** The US state lists (Nov 17): the 50 states, the same set in both, typed the same way. */
export const STATE_LISTS = ["us-states-population", "us-states-area"];
/** What a US state list names: "Name a US state with about 5 million people". */
export const STATE_NOUN = { noun: "US state", nounPlural: "US states" } as const;

const KEYS = ["id", "noun", "nounPlural", "measure", "scoring", "source", "asOf", "entries"];

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

async function main() {
  const population = puzzle("countries-population");
  const area = puzzle("countries-area");
  const cities = puzzle("world-cities");

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

  // Every city the world cities list ranks (UN 2025 urban agglomerations); its other accepted answers have no figure.
  write({
    id: "cities-population",
    noun: "city",
    nounPlural: "cities",
    measure: "people",
    scoring: "ratio",
    source: { title: pageTitle(cities), url: cities.source.url },
    asOf: cities.source.dataAsOf ?? cities.source.asOf,
    entries: uniqueForms(
      currentForms(
        all(cities)
          .filter((e) => e.rank > 0 && e.n !== undefined)
          .map((e) => ({ name: e.name, aliases: e.aliases, value: e.n! })),
        "cities",
      ),
    ),
  });

  // The 50 US states (Nov 17), from the two state puzzles: one set of states and one set of forms in both lists, the
  // puzzles' own (postal codes, "Calif.", "New York State"), less what isn't a name.
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

  const read = (id: string) => JSON.parse(readFileSync(join(LISTS_DIR, `${id}.json`), "utf8")) as NameList;
  const errors = [...checkCountryLists(COUNTRY_LISTS.map(read)), ...checkStateLists(STATE_LISTS.map(read))];
  if (errors.length) throw new Error(errors.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
