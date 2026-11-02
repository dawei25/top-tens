// Builds public/puzzles/*.json from the Wikipedia tables listed in topics.ts.
// Usage: npm run build:puzzles [-- topic-id ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry, Fact, Puzzle } from "../src/game/types";
import { normalize } from "../src/game/match";
import { cleanText, splitHeader, statNumber, tableGrid, wikitables, type Cell } from "./table";
import { TEST_SET, TOPICS, type Dated, type Topic } from "./topics";
import { fetchCategory, fetchPage, fetchRedirects, pageUrl, requestCount } from "./wiki";
import { addValues } from "./values";
import { writeLexicon } from "./lexicon";
import { tableDataDate } from "./dates";
import { CITY_FORMS, COUNTRY_FORMS, INTENT, NICKNAMES, STATE_FORMS } from "./intent";

/** Postal codes that are everyday words: never aliases. */
const WORD_CODES = new Set(["IN", "OR", "ME", "HI", "OK", "OH"]);
import { UNIVERSES, US_STATE_CODES, type Place } from "./gazetteer";
import { bareWord, baseTitle, blockedAlias, CELEBRITY_JUNK, CITY_JUNK, COMPANY_JUNK, COUNTRY_JUNK, isEnglishWord, junkRedirect } from "./aliases";

const OUT_DIR = join(import.meta.dirname, "..", "public", "puzzles");
/** Fewest entries with a stat (`n`) for a list to be playable in Blitz. */
const BLITZ_MIN = 30;
/** Wikipedia article behind each entry, where known; only used during the build (values for unranked answers). */
const ARTICLE = new WeakMap<Entry, string>();
const articleOf = (e: Entry) => ARTICLE.get(e) ?? e.name;
/** The article a table cell links for an unranked entry, whatever the cell says: another name for the same thing. */
const LINK = new WeakMap<Entry, string | undefined>();
/** Aliases an unranked entry takes from other columns (the artist of a tour): names of something else, so they never
 * make it the same thing as another entry. */
const COLUMN_ALIASES = new WeakMap<Entry, Set<string>>();
const ownForms = (e: Entry) => [e.name, ...e.aliases.filter((a) => !COLUMN_ALIASES.get(e)?.has(a))];

const SPELLED_OUT: Record<string, string> = { st: "saint", ste: "sainte", mt: "mount", ft: "fort" };

/** Words that can stand first or last in a name of the same thing: "River Paraguay" is "Paraguay River". */
const MOVABLE = new Set(["river", "lake", "loch", "lough", "mount", "isle", "island", "islands", "cape"]);

/**
 * A key under which two spellings of the same thing meet: "St. Lawrence River" and "Saint Lawrence River",
 * "River Paraguay" and "Paraguay River", "Gatwick Airport (London)". Qualifiers, case and accents go; word order
 * stays ("John Collins" is not "Collins John").
 */
export function sameKey(name: string): string {
  // "Nukuʻalofa" and "Nuku'alofa": normalize() reads the ʻokina as a word break, the apostrophe as nothing.
  const words = normalize(baseTitle(name).replace(/[ʻʼ`'’]/g, ""))
    .split(" ")
    .map((w) => SPELLED_OUT[w] ?? w);
  if (words.length > 1 && MOVABLE.has(words[0])) words.push(words.shift()!);
  return words.join(" ");
}
/** Every table row is an accepted answer; this only guards against runaway tables. */
const MAX_ROWS = 1000;

interface Row {
  name: string;
  value: number;
  /** The topic's `tiebreak` column: decides between rows with the same value. */
  tiebreak?: number;
  valueText: string;
  aliasSeeds: string[];
  redirectTarget: string;
  /** The article the name cell links, even when it isn't used for redirects. */
  link?: string;
  /** What tells this row apart from another row with the same name: its year or its article's qualifier. */
  tag?: string;
  /** The name it shares with such a namesake ("The Lion King" for "The Lion King (1994)"). */
  plain?: string;
}

function column(header: string[], spec: string | number): number {
  if (typeof spec === "number") return spec;
  // Spacing is ignored: a header's line break ("Total<br>passengers") reads as a space.
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const i = header.findIndex((h) => squash(h).includes(squash(spec)));
  if (i < 0) throw new Error(`no column matching "${spec}" in [${header.join(" | ")}]`);
  return i;
}

function cleanName(s: string): string {
  return cleanText(s)
    .replace(/\s*\(.*?\)\s*/g, " ")
    // A parenthesis the table never closes: "IShowSpeed (Darren Watkins Jr.".
    .replace(/\s*\([^)]*$/, "")
    .replace(/[†‡*^#⁂§¤]+/g, "")
    .replace(/^"|"$/g, "")
    .replace(/\s+(&|and) (family|brothers|sisters|sons)$/i, "")
    .trim();
}

/**
 * A family row names several people: "Karl and Theo Albrecht" links only "Karl". Each first name gets the shared
 * surname ("Karl Albrecht"), instead of a bare "Karl" that would cost a life.
 */
function familyName(name: string, cellText: string): string {
  const m = cleanName(cellText).match(/^(\S+) (?:and|&) .+ (\S+)$/);
  return m && name === m[1] && !name.includes(" ") ? `${m[1]} ${m[2]}` : name;
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

/** A low and a high figure as one range: "400–600 million", "500 million–1 billion", "600 million" if they agree. */
export function rangeText(low: string, high: string): string {
  if (low === high) return low;
  const unit = (s: string) => s.match(/\s(million|billion|trillion)$/)?.[1];
  if (unit(low) && unit(low) === unit(high)) return `${low.replace(/\s\S+$/, "")}–${high}`;
  return `${low}–${high}`;
}

/** Same value, and same tiebreak where the topic has one: a tie the ranking can't split. */
const sameValue = (a: Row, b: Row) => a.value === b.value && a.tiebreak === b.tiebreak;

/** Aliases a player could type: at least two letters or digits, and not a bare number ("V", "2"). */
function usableAlias(alias: string, name: string): boolean {
  const n = normalize(alias);
  if (n.replace(/ /g, "").length < 2) return false;
  // "329,715.1" from a number column, "4,256" (Pete Rose's hits): numbers, not names.
  return !/^[\d ]+$/.test(n) || /^[\d ]+$/.test(normalize(name));
}

/** Country, state and capital names: a short form that is one of these names a place, not the entry. */
const PLACES = new Set(
  [...UNIVERSES.countries(), ...UNIVERSES["us-states"](), ...UNIVERSES.capitals()].map((p) => normalize(p.name)),
);

const GENERIC_WORDS =
  /\b(international airport|airport|stadium|mount|lake|island|corporation|corp|company|inc|group|tower|the)\b/gi;

/**
 * "PUBG: Battlegrounds" → PUBG; "Atlanta International Airport" → Atlanta. Collisions are pruned later. Parts that
 * mean nothing alone are left out: plain words ("Deluxe", "Impossible"; a word of the name is still matched as one),
 * places ("Missouri"), "Part 2", and fragments like "of Brazil" or "Salt City–Murray".
 */
function shortForms(name: string, strip?: RegExp | RegExp[]): string[] {
  // "Family Computer/Nintendo Entertainment System", "Mississippi–Missouri", "PUBG: Battlegrounds".
  const out = name
    // A slash between digits is part of the name: "National 9/11 Museum".
    .split(/\s*[:–]\s*|(?<!\d)\s*\/\s*(?!\d)|\s+-\s+/)
    .filter((p) => p !== name && !(isWord(p) || PLACES.has(normalize(p))));
  // Hawaiʻi is typed "Hawaii": normalize() keeps the ʻokina as a word break.
  if (/[ʻʼ`]/.test(name)) out.push(name.replace(/[ʻʼ`]/g, ""));
  for (const words of [GENERIC_WORDS, ...[strip ?? []].flat()]) {
    // A word gone from the middle of a phrase garbles it: "Salt City–Murray", "Lake of Woods", "Leaning of Pisa".
    const marked = name.replace(words, GAP).replace(new RegExp(`${GAP}(\\s*${GAP})*`, "g"), GAP);
    if (new RegExp(`\\p{L}\\s+${GAP}\\s+\\p{L}`, "u").test(marked)) continue;
    const stripped = marked.replaceAll(GAP, " ").replace(/\s+/g, " ").replace(/\s*([–-])\s*/g, "$1").trim();
    // "Salt" (Salt Lake Stadium), "Australia" (Stadium Australia), "South" (South Island) mean something else alone.
    if (stripped !== name && !bareWord(stripped, PLACES)) out.push(stripped);
  }
  return out.filter(
    (s) => s.replace(/\W/g, "").length >= 3 && !CONNECTOR_START.test(s.trim()) && !CONNECTOR_END.test(s.trim()) && !PART.test(s.trim()),
  );
}

const GAP = "\u0002";
/** A single plain English word. */
const isWord = (s: string) => !normalize(s).includes(" ") && isEnglishWord(normalize(s));
/** Pieces that aren't names: "of Brazil", "and Futuna" (lower case: "The Two Towers" is a name). */
const CONNECTOR_START = /^(of|and|the|in|on|at|de|du|des|la|le|del|y)\s/;
/** Pieces cut off before their last word: "Love On" (Love On Tour), "Living Proof: The Farewell". */
const CONNECTOR_END = /\s(of|and|the|in|on|at|to|for|with)$/i;
/** "Part 2", "Vol. 1": which part, not which work. */
const PART = /^(part|chapter|volume|vol\.?|episode|book|season)\s*\d+$/i;

/** Little words a title keeps in lower case inside it: "Shape of You", "Die with a Smile", "Take Me to Church". */
const SMALL_WORDS = new Set("a an the and but or nor of in on at to for by with as".split(" "));

/** "Locked Out Of Heaven" → "Locked Out of Heaven": the first and last words stay capitalized. */
export function titleCase(name: string): string {
  const words = name.split(" ");
  return words.map((w, i) => (i > 0 && i < words.length - 1 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(" ");
}

function cellName(cell: Cell, topic: Pick<Topic, "nameFromText" | "nameFromLink" | "nameStrip" | "titleCase">): string {
  if (topic.nameFromLink && cell.link) return cleanName(cell.link);
  let name = cleanName(topic.nameFromText || !cell.linkText ? cell.text : cell.linkText);
  if (topic.nameStrip) name = name.replace(topic.nameStrip, "").trim();
  // "ROSÉ" in the table is "Rosé" in her article: the article's casing. A table that writes every word capitalized
  // links redirects with that casing too ("Shape Of You"), so `titleCase` comes after.
  const linked = cell.link ? cleanName(cell.link) : "";
  if (linked !== name && linked.toLowerCase() === name.toLowerCase()) name = linked;
  if (topic.titleCase) name = titleCase(name);
  // Untypeable names ("Маша и Медведь") fall back to the linked article's title, if that is typeable.
  if (!normalize(name) && cell.link && normalize(cleanName(cell.link))) return cleanName(cell.link);
  return name;
}

/**
 * Total rows, notes and tier headings ("$50 billion+") that tables mix in with real rows. "Total" must be a whole
 * word ("TotalEnergies" and "TotalBiscuit" are names), and a title-cased word after it makes a name too ("Total War",
 * "Total Recall", "Total Eclipse of the Heart"), unless that word names the area being totalled ("Total US and
 * territories").
 */
const SKIP_NAME =
  /^(as of\b|last updated\b|world( total)?$|others?$|various$|unknown$|[$€£]\d|(player|name|rank|country|team|title)$)/i;
const TOTAL_ROW = /^(?:[Gg]rand [Tt]otal|GRAND TOTAL|[Ss]ubtotal|SUBTOTAL|[Tt]otals?|TOTALS?)\b(?!\s+(?!(?:US|U\.S\.|USA|World|EU|Europe|Global|All)\b)\p{Lu})/u;
export const skipName = (name: string) => SKIP_NAME.test(name) || TOTAL_ROW.test(name);

/**
 * Use the linked article for redirects only if it is about the thing itself ("Avatar (2009 film)", not
 * "Demographics of India"). On country lists a link to a country is that country, whatever the row calls it
 * ("Congo" linking Republic of the Congo).
 */
function redirectTarget(name: string, cell: Cell, countries = false): string {
  if (!cell.link) return name;
  const link = normalize(cleanName(cell.link));
  // "Lake Baikal" for "Baikal" is the same thing; "Demographics of India" is not.
  if (link === normalize(name) || (link.includes(normalize(name)) && !/\b(of|in|at)\b/.test(link))) return cell.link;
  // "Dhaulagiri I" linking "Dhaulagiri": the main peak's article (the numbered title has none).
  if (/^\d+$/.test(normalize(name).slice(link.length + 1)) && normalize(name).startsWith(link + " ")) return cell.link;
  if (countries && COUNTRY_NAMES.has(link)) return cell.link;
  // "Congo" linking "Petroleum industry in the Republic of the Congo" is that country.
  const tail = cleanName(cell.link).match(/\s(?:in|of)\s(?:the\s)?(.+)$/)?.[1];
  if (countries && tail && COUNTRY_NAMES.has(normalize(tail)) && normalize(tail).includes(normalize(name))) return tail;
  return name;
}

const hasCountries = (topic: Topic) => [topic.universe ?? []].flat().includes("countries");

/** A value from another column, converted (`fallback` in topics.ts), shown rounded with commas. */
function convertedValue(cell: Cell | undefined, factor: number): { value: number; display: string } | null {
  const v = cell && parseValue(cell.text);
  if (!v) return null;
  const value = Math.round(v.value * factor);
  return { value, display: value.toLocaleString("en-US") };
}

/**
 * Warnings for numbers that were probably misread: "382.936" in a column of "1,723,337"s (a dot used as the
 * thousands separator), and a km² cell that disagrees with the same row's square miles.
 */
function checkNumbers(topic: Topic, header: string[], body: Cell[][], vc: number): void {
  const texts = body.map((r) => r[vc]?.text ?? "");
  const commas = texts.filter((t) => /\d,\d{3}\b/.test(t)).length;
  for (const [i, t] of texts.entries()) {
    if (/^\D{0,3}\d{1,3}\.\d{3}(?!\d)/.test(t) && commas > texts.length / 2) {
      console.log(`warn ${topic.id}: "${t}" (${body[i][0]?.text}) looks like a dot thousands separator`);
    }
  }
  if (!/\bkm\b/i.test(header[vc] ?? "")) return;
  const mc = header.findIndex((h) => h === header[vc].replace(/\bkm\b/i, "mi"));
  if (mc < 0) return;
  for (const r of body) {
    const km = parseValue(r[vc]?.text ?? "")?.value;
    const mi = parseValue(r[mc]?.text ?? "")?.value;
    // Areas: km² = 2.59 × mi². Densities (people per km²) go the other way.
    const ratio = km && mi ? km / mi : 0;
    if (ratio && Math.abs(ratio / 2.589988 - 1) > 0.02 && Math.abs(ratio * 2.589988 - 1) > 0.04) {
      console.log(`warn ${topic.id}: ${r[0]?.text}: ${r[vc].text} km² is ${(km / mi).toFixed(2)} × ${r[mc].text} mi² (expected 2.59)`);
    }
  }
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

/** Names of the rows a topic's tables leave unranked, where `unrankedRowsFree` makes them free. */
const UNRANKED_ROWS = new Map<string, Set<string>>();
const unrankedRows = (topic: Topic) => UNRANKED_ROWS.get(topic.id) ?? UNRANKED_ROWS.set(topic.id, new Set()).get(topic.id)!;

export async function readRows(topic: Topic): Promise<Row[]> {
  const $ = await fetchPage(topic.page);
  const tables = wikitables($);
  const rows: Row[] = [];
  const members = topic.canonical ? [topic.universe ?? []].flat().flatMap((u) => UNIVERSES[u]()) : [];
  for (const t of topic.tables) {
    const { header, body } = splitHeader(tableGrid($, tables[t]));
    const nc = column(header, topic.name);
    const vc = column(header, topic.value);
    const tc = topic.tiebreak === undefined ? -1 : column(header, topic.tiebreak);
    const aliasCs = (topic.aliasCols ?? []).map((a) => column(header, a));
    const fromCol = topic.fallback ? column(header, topic.fallback.from) : -1;
    const yc = header.findIndex((h) => /^(year|released?|release date)\b/i.test(h));
    if (!topic.fallback) checkNumbers(topic, header, body, vc);
    for (const r of body) {
      const nameCell = r[nc];
      const valueCell = r[vc];
      if (!nameCell || !valueCell || nameCell.isHeader && !nameCell.text) continue;
      const cellText = (members.length && universeName(nameCell.text, members)) || cellName(nameCell, topic);
      if (!cellText || !normalize(cellText) || topic.skip?.includes(cellText) || skipName(cellText)) continue;
      // A row the ranking leaves out (no rank, no figure) is free where the topic says so: Monaco has no IMF figure.
      const unranked = () => {
        if (topic.unrankedRowsFree) unrankedRows(topic).add(normalize(cellText));
      };
      if (topic.rankedOnly && !/^\d/.test(r[0]?.text ?? "")) {
        unranked();
        continue;
      }
      const name = topic.rename?.[cellText] ?? cellText;
      if (topic.where && !topic.where.match.test(r[column(header, topic.where.col)]?.text ?? "")) continue;
      if (!topic.numberNames && /\d{3,}.*\d{3,}/.test(name)) continue; // ad uploads and other non-titles
      const override = topic.overrides?.[cellText];
      if (override) console.log(`     ${topic.id}: ${cellText} ${valueCell.text} → ${override.value} (${override.source})`);
      let v = parseValue(override?.value ?? valueCell.text);
      if (topic.fallback && !override) {
        // A cell that disagrees with the other column by more than 2% was misread on the page ("382.936").
        const alt = convertedValue(r[fromCol], topic.fallback.factor);
        if (alt && (!v || Math.abs(v.value / alt.value - 1) > 0.02)) {
          console.log(`     ${topic.id}: ${name} ${valueCell.text} → ${alt.display} (from ${r[fromCol].text} × ${topic.fallback.factor})`);
          v = alt;
        }
      }
      // A count of nothing (a team with no titles) ranks nothing; the universe still accepts the name.
      if (!v || (v.value === 0 && !topic.lowerIsBetter)) {
        if (!v) unranked();
        continue;
      }
      // One name per line of the cell: "Mount Everest / Sagarmatha / Chomolungma" are three aliases, not one glued string.
      // A river system's cell ("Saint Lawrence–Niagara–Detroit–...") names other rivers after the first.
      const lines = (nameCell.lines.length > 1 ? nameCell.lines : [nameCell.text]).filter((l) => !topic.noParts || !/[–-]/.test(l));
      const seeds = [...lines, nameCell.linkText ?? "", ...shortForms(name, topic.stripWords)].map((s) =>
        topic.nameStrip ? s.replace(topic.nameStrip, "").trim() : s,
      );
      if (name !== cellText) seeds.push(cellText);
      // The cell can say more than the name: "Mississippi–Missouri–Jefferson" names the Mississippi row.
      for (const line of lines) if (cleanName(line) !== name) seeds.push(...shortForms(cleanName(line)));
      for (const c of aliasCs) {
        const cell = r[c];
        // "Atlanta, Georgia" names the row by "Atlanta", not by "Georgia": keep the first part of a place.
        if (cell) seeds.push(cell.linkText ?? "", ...cell.lines.flatMap((l) => l.split("/")).map((part) => part.split(",")[0]));
      }
      // The article's own title is never among its redirects ("Acadia National Park" for "Acadia").
      // A renamed row ("Disneyland Park" shown as "Disneyland Paris") keeps the article its table name links.
      const viaCell = redirectTarget(cellText, nameCell, hasCountries(topic));
      const target = topic.articles?.[name] ?? (viaCell !== cellText ? viaCell : redirectTarget(name, nameCell, hasCountries(topic)));
      if (target !== name) seeds.push(target);
      const t = tc >= 0 ? parseValue(r[tc]?.text ?? "") : null;
      rows.push({
        name,
        value: v.value,
        ...(t ? { tiebreak: t.value } : {}),
        valueText: t && t.value >= v.value ? rangeText(v.display, t.display) : v.display,
        aliasSeeds: seeds.map(cleanName).filter((s) => s && s.length > 1),
        redirectTarget: target,
        link: nameCell.link,
        tag: rowTag(yc >= 0 ? r[yc] : undefined, nameCell.link),
      });
    }
  }
  for (const name of Object.keys(topic.overrides ?? {})) {
    if (!rows.some((r) => r.name === (topic.rename?.[name] ?? name))) console.log(`warn ${topic.id}: override for "${name}", which is not a row`);
  }
  if (!topic.keepOrder) rows.sort((a, b) => b.value - a.value || (b.tiebreak ?? 0) - (a.tiebreak ?? 0));
  // "3.2 million" among "6,301,972"s reads as another unit: write it out like the rest.
  const worded = rows.filter((r) => /\b(million|billion|trillion)$/.test(r.valueText));
  if (worded.length && worded.length < rows.length / 2) {
    for (const r of worded) r.valueText = Math.round(r.value).toLocaleString("en-US");
  }
  return distinctRows(topic, rows);
}

/**
 * One name, several rows. The same thing listed twice (one article, or nothing to tell them apart) is one entry,
 * the first. Different things that share a name stay apart: The Lion King of 1994 and of 2019, the city and the
 * district of North Vancouver. Each is named with its year or its article's qualifier ("The Lion King (1994)",
 * "North Vancouver (city)") and keeps the plain name as an alias, which the game reads the natural way.
 */
function distinctRows(topic: Topic, rows: Row[]): Row[] {
  const kept = new Map<string, Row[]>();
  for (const r of rows) {
    const k = normalize(r.name);
    const same = kept.get(k);
    if (!same) kept.set(k, [r]);
    else if (r.link && r.tag && same.every((s) => s.link && s.link !== r.link && s.tag && s.tag !== r.tag)) same.push(r);
  }
  const out: Row[] = [];
  for (const r of rows) {
    const group = kept.get(normalize(r.name))!;
    if (!group.includes(r)) continue;
    if (group.length > 1) {
      if (!r.aliasSeeds.includes(r.name)) r.aliasSeeds.push(r.name);
      r.plain = r.name;
      r.name = `${r.name} (${r.tag})`;
      console.log(`     ${topic.id}: "${r.name}" kept apart from its namesake (${r.link})`);
    }
    out.push(r);
  }
  return out;
}

/** A year in a cell or a qualifier: "1994", "(2019 film)". */
const YEAR_IN = /\b(1[89]\d\d|20\d\d)\b/;
/** The qualifier of an article title: "city" in "North Vancouver (city)". */
const qualifierOf = (title?: string) => title?.match(/\(([^()]+)\)$/)?.[1];

/**
 * What tells a row apart from a namesake: the year in its article's qualifier ("(2019 film)"), else the qualifier
 * without the kind of work ("Queen" from "(Queen album)", "city", "Berlin"), else its Year column ("1994").
 */
function rowTag(yearCell: Cell | undefined, link?: string): string | undefined {
  const q = qualifierOf(link);
  const who = q?.replace(/\s+(album|song|single|film|novel|book|video game|game|TV series)$/i, "");
  return q?.match(YEAR_IN)?.[0] ?? who ?? yearCell?.text.match(YEAR_IN)?.[0];
}

/** The latest year of an entry's value from a `dated` table, for keeping its most recent one. */
const DATED = new WeakMap<Entry, number>();

/** A year or a span of years: "2024", "1987–1989". */
const YEARS = /(?<!\d)((?:19|20)\d{2})(?:\s*[–-]\s*((?:19|20)\d{2}))?(?!\d)/;

/**
 * When a `dated` table's ranking is from: its label, with "{year}" (or, without a label, the whole label) taken
 * from the first header that names a year ("Arrivals 2024", "Rank in 2020"), else from the table's caption or
 * heading ("1987–1989").
 */
export function datedLabel(d: Pick<Dated, "label">, headers: string[], title: string): string | undefined {
  const year = [...headers, title]
    .map((t) => (t ?? "").match(YEARS))
    .find(Boolean)?.[0]
    .replace(/\s*[–-]\s*/, "–");
  if (!d.label) return year;
  if (!d.label.includes("{year}")) return d.label;
  return year && d.label.replace("{year}", year);
}

/** The last year a label names: "1987–1989" is 1989, "Q4 2025" is 2025. */
export const labelYear = (label: string) => Math.max(0, ...[...label.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/g)].map((m) => Number(m[0])));

/**
 * How an answer's rank and figure from another year's (or source's) table read: "#6 in 2024 (16.5 million)",
 * "#3 in 2019" (no figure), "2.98 million (Mastercard, 2016)" (no rank). Undefined when the row has neither.
 */
export function datedValue(label: string, rank?: number, figure?: string, source?: string): string | undefined {
  if (rank) {
    const more = [source, figure].filter(Boolean);
    return `#${rank} in ${label}${more.length ? ` (${more.join(", ")})` : ""}`;
  }
  return figure ? `${figure} (${[source, label].filter(Boolean).join(", ")})` : undefined;
}

/** A number in the shown unit: 16,500,000 at scale 1e6 is "16.5", 4,238,000 at 1e3 "4,238", 720,000 at 1e6 "0.72". */
export function scaledFigure(value: number, scale: number): string {
  const x = value / scale;
  if (x >= 100) return Math.round(x).toLocaleString("en-US");
  if (x >= 1) return x.toFixed(1);
  return String(Number(x.toPrecision(2)));
}

/** A rank cell: "6", "=5", "3/4" (shared: the first). Undefined for "-", "N/A" or nothing. */
export function rankOf(text: string | undefined): number | undefined {
  const n = Number(text?.match(/^\s*[=T]?-?\s*(\d{1,4})\b/)?.[1]);
  return n > 0 ? n : undefined;
}

/** A figure at the end of a name cell: "Tencent 688,000", "ExxonMobil 356,548.7". */
const FIGURE_END = /\s+(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+)\s*$/;

/** A table's caption, else the heading above it. */
function tableTitle($: Awaited<ReturnType<typeof fetchPage>>, table: Parameters<typeof tableDataDate>[1]): string {
  return cleanText($(table).find("caption").first().text()) || cleanText($(table).prevAll("h2, h3, h4, div.mw-heading").first().text());
}

/**
 * Gives an answer a dated value from a namesake row of a later `dated` table (or another source's), when the
 * answer is unranked and has no figure of its own or only an older dated one. The first table listed wins a tie.
 */
function adoptDated(owner: Entry, e: Entry): void {
  const year = DATED.get(e);
  if (year === undefined || owner.rank !== 0 || owner.n !== undefined) return;
  const had = DATED.get(owner);
  if (owner.value !== undefined && (had === undefined || had >= year)) return;
  owner.value = e.value;
  DATED.set(owner, year);
}

/**
 * Unranked accepted answers from other tables (or pages): aliases from the cell and short forms, and the list's
 * stat when the source has a `value` column for it (only below `limit`, the last ranked row's number), or a rank
 * and figure from another year's table (`dated`).
 */
async function readAlso(topic: Topic, limit: number): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const src of topic.also ?? []) {
    const $ = await fetchPage(src.page ?? topic.page);
    const tables = wikitables($);
    for (const t of src.tables) {
      const { header, body } = splitHeader(tableGrid($, tables[t]));
      const nc = column(header, src.name);
      const vc = src.value === undefined ? -1 : column(header, src.value);
      const rc = src.dated?.rank === undefined ? -1 : column(header, src.dated.rank);
      // A table of one row per year labels each row with its own year.
      const perYear = src.dated?.perYear;
      const yc = perYear ? column(header, perYear.col) : -1;
      const tableLabel =
        src.dated && !perYear && datedLabel(src.dated, [vc, rc, nc].filter((c) => c >= 0).map((c) => header[c]), tableTitle($, tables[t]));
      if (src.dated && !perYear && !tableLabel) throw new Error(`no year for dated table ${t} (give it a label)`);
      const aliasCs = (src.aliasCols ?? []).map((a) => column(header, a));
      for (const r of body) {
        const cell = r[nc];
        if (!cell || (cell.isHeader && !cell.text)) continue;
        if (src.where && !src.where.match.test(r[column(header, src.where.col)]?.text ?? "")) continue;
        // "Tencent 688,000": the figure follows the name in the same cell.
        const glued = src.dated?.figureInName ? cell.text.match(FIGURE_END) : null;
        const unglue = (s: string) => (src.dated?.figureInName ? s.replace(FIGURE_END, "") : s);
        const named = unglue(cellName(cell, src));
        const raw = familyName(named, cell.text);
        const name = src.rename?.[raw] ?? raw;
        if (!name || !normalize(name) || skipName(name)) continue;
        if (topic.skip?.includes(name) || src.skip?.includes(name)) continue;
        if (!topic.numberNames && /\d{3,}.*\d{3,}/.test(name)) continue;
        // A family row's text ("Karl and Theo Albrecht") names several people: not an alias of one of them.
        const family = raw !== named;
        const lines = family ? [] : (cell.lines.length > 1 ? cell.lines : [cell.text]).map(unglue);
        const others = aliasCs.flatMap((c) => (r[c] ? [r[c].linkText ?? "", ...r[c].lines.flatMap((l) => l.split("/")).map((p) => p.split(",")[0])] : []));
        const aliases = [...lines, family ? "" : cell.linkText ?? "", ...shortForms(name, topic.stripWords), ...others].map(cleanName);
        const entry: Entry = { rank: 0, name, aliases: aliases.filter((a) => a && a !== name) };
        const v = topic.lowerIsBetter ? null : glued ? parseValue(glued[1]) : vc >= 0 ? parseValue(r[vc]?.text ?? "") : null;
        const label = perYear ? datedLabel(src.dated!, [r[yc]?.text ?? ""], "") : tableLabel;
        if (src.dated && label) {
          const d = src.dated;
          const sign = d.prefix ?? v?.display.match(/^[$€£]/)?.[0] ?? "";
          const digits = v && (d.scale ? scaledFigure(v.value, d.scale) : v.display.replace(/^[$€£]/, ""));
          const figure = v && v.value > 0 ? sign + digits + (d.unit ?? topic.unit ?? "") : undefined;
          const shown = datedValue(label, rc >= 0 ? rankOf(r[rc]?.text) : perYear?.rank, figure, d.source);
          if (shown) {
            entry.value = shown;
            DATED.set(entry, labelYear(label));
          }
        } else if (!src.dated && v && v.value > 0 && v.value < limit) {
          entry.value = (topic.prefix ?? "") + v.display + (topic.unit ?? "");
          entry.n = statNumber(v.value);
        }
        ARTICLE.set(entry, family ? name : redirectTarget(name, cell, hasCountries(topic)));
        LINK.set(entry, cell.link);
        COLUMN_ALIASES.set(entry, new Set(others.map(cleanName).filter((a) => a && !lines.map(cleanName).includes(a))));
        out.push(entry);
      }
    }
  }
  for (const cat of topic.universeCategories ?? []) {
    const titles = await fetchCategory(cat, topic.categoryDepth ?? 0, CATEGORY_CAP);
    if (!titles.length) console.log(`warn ${topic.id}: category "${cat}" is empty or missing`);
    for (const title of titles) {
      if (CATEGORY_SKIP.test(title) || topic.categorySkip?.test(title) || topic.skip?.includes(title)) continue;
      if (topic.categoryNames && !looksLikeName(baseTitle(title))) continue;
      const name = cleanName(title);
      if (!normalize(name) || skipName(name)) continue;
      // The title's qualifier ("Ben Taylor (first baseman, born 1888)") is nothing a player types.
      const entry: Entry = { rank: 0, name, aliases: name === baseTitle(title) ? [] : [baseTitle(title)] };
      ARTICLE.set(entry, title);
      out.push(entry);
    }
  }
  for (const [name, aliases] of Object.entries(topic.more ?? {})) out.push({ rank: 0, name, aliases: [...aliases] });
  return out;
}

/** Lowercase words a name can have in the middle ("Leaning Tower of Pisa", "Mont Blanc du Tacul"). */
const NAME_PARTICLES = new Set("of the and in on at for to a an de du des la le el del di da von van der den y e al".split(" "));

/**
 * A category member that reads like a name: "Yahoo Search", "BeReal", not "Search engine bias" (a concept article,
 * in sentence case) or "Display" (a plain dictionary word).
 */
function looksLikeName(title: string): boolean {
  const ws = title.split(/\s+/);
  if (ws.length === 1) return !/^\p{Lu}\p{Ll}+$/u.test(title) || !isEnglishWord(title);
  return ws.slice(1).every((w) => !/^\p{Ll}/u.test(w) || NAME_PARTICLES.has(w) || /['’.]/.test(w));
}

/** Most titles taken from a topic's categories. */
const CATEGORY_CAP = 3000;
/** Category members that are not things a player would name: lists, overviews, years, other namespaces. */
const CATEGORY_SKIP =
  /^((lists?|index|outline|history|timeline|glossary|bibliography|discography|filmography) of\b|\d{3,4}\b|(category|template|wikipedia|portal|file|help|draft|module):)|\(disambiguation\)$/i;

/** An alias shared by more entries than this is too generic to mean any of them ("Mount", "Lake"). */
const MAX_GROUP = 4;

/**
 * Alias hygiene. An alias that is another entry's name is dropped (typing "Avatar" means Avatar).
 * An alias shared by 2-4 entries stays on all of them, so the game can ask which one was meant; the same goes
 * for an alias that starts other entries' names ("Grand Theft Auto" joins GTA V, GTA IV and San Andreas).
 * Anything broader is dropped. `namesakes`: the plain name of entries kept apart by year or qualifier ("The Lion
 * King"), which belongs to them as a name does: no other entry keeps it ("Mufasa: The Lion King").
 */
function pruneAliases(entries: Entry[], namesakes = new Map<string, Set<Entry>>()): void {
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
      const same = namesakes.get(n);
      if (same) {
        if (same.has(e)) for (const g of same) kept.get(g)!.set(n, a);
        continue;
      }
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
  /** A group's size (intent.ts `groups`): how many entries it names. */
  group?: number;
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
    // "Congo" is two countries: the game asks which one.
    const congo = (first: string) => {
      const forms = new Set(COUNTRY_FORMS.find((f) => f[0] === first)!.map(normalize));
      return entries.find((e) => forms.has(normalize(e.name)));
    };
    const [drc, roc] = [congo("DR Congo"), congo("Republic of the Congo")];
    if (drc && roc) for (const alias of ["Congo", "Congolese"]) out.push({ alias, targets: [drc, roc], strict: false });
  }
  if (/\bcities\b/.test(topic.noun)) {
    for (const forms of CITY_FORMS) {
      const set = new Set(forms.map(normalize));
      // The city's usual name first: "Frisco" is a Texas city of its own, not San Francisco.
      let hits = entries.filter((e) => normalize(e.name) === normalize(forms[0]));
      if (!hits.length) hits = entries.filter((e) => set.has(normalize(e.name)));
      if (hits.length !== 1) continue;
      for (const alias of forms) out.push({ alias, targets: hits, strict: false });
    }
  }
  if (topic.people) {
    for (const [name, aliases] of Object.entries(NICKNAMES)) {
      const hits = entries.filter((e) => e.name === name);
      if (hits.length !== 1) continue;
      // "The Answer", "The Glove": a nickname that is one plain word catches that word typed for anything else.
      const own = normalize(name).split(" ");
      for (const alias of aliases) {
        const n = normalize(alias);
        if (!n.includes(" ") && isEnglishWord(n) && !own.includes(n) && !/^[A-Z0-9]{2,4}$/.test(alias)) continue;
        out.push({ alias, targets: hits, strict: false });
      }
    }
  }
  if ([topic.universe ?? []].flat().includes("us-states")) {
    for (const [state, code] of US_STATE_CODES) {
      const hits = entries.filter((e) => e.name === state);
      // "in", "or", "me", "hi", "ok", "oh" are words a player types for other reasons.
      if (hits.length === 1 && !WORD_CODES.has(code)) out.push({ alias: code, targets: hits, strict: false });
      for (const alias of STATE_FORMS[state] ?? []) if (hits.length === 1) out.push({ alias, targets: hits, strict: false });
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
    out.push({ alias, targets: find(members), strict: true, group: members.length });
  }
  return out;
}

/**
 * Put curated aliases on the entries that exist so far, before universe members are merged in, so that
 * "United Kingdom" (meaning Great Britain on the islands list) does not come back as a separate country entry.
 */
function seedIntent(topic: Topic, entries: Entry[]): void {
  // A group waits until all its entries exist: seeded on some, it would swallow the rest as the same answer (Cher's
  // "The Farewell Tour" into Elton John's, which shares "Farewell Tour").
  for (const { alias, targets, group } of curated(topic, entries, false)) {
    if (group && targets.length < group) continue;
    for (const e of targets) e.aliases.push(alias);
  }
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

/** "https://en.wikipedia.org/wiki/The_Lion_King_(2019_film)" → "the lion king 2019 film". */
const urlTitle = (url: string) => {
  const m = url.match(/\/wiki\/([^?#]+)/);
  if (!m) return "";
  try {
    return normalize(decodeURIComponent(m[1]).replace(/_/g, " "));
  } catch {
    return normalize(m[1].replace(/_/g, " "));
  }
};

/**
 * Which fact (by its key in the facts file) belongs to each top-10 answer, so a rename keeps its fact: the exact
 * name, then the name normalized ("Shape Of You" is "Shape of You"), then a fact whose source is the answer's
 * article ("The Lion King" sourced from "The Lion King (2019 film)"), then a key that is the article's title or one
 * of the answer's aliases. Past the exact name, a key only goes to an answer if no other answer fits it at that
 * step, and each key goes to one answer.
 */
export function matchFacts(
  facts: Record<string, Fact>,
  top: Pick<Entry, "name" | "aliases" | "article">[],
): (string | undefined)[] {
  const out: (string | undefined)[] = top.map(() => undefined);
  const keys = Object.keys(facts);
  const steps: ((key: string, e: (typeof top)[number]) => boolean)[] = [
    (k, e) => k === e.name,
    (k, e) => normalize(k) === normalize(e.name),
    (k, e) => !!e.article && urlTitle(facts[k].source ?? "") === normalize(e.article),
    (k, e) => !!e.article && normalize(k) === normalize(e.article),
    (k, e) => e.aliases.some((a) => normalize(a) === normalize(k)),
  ];
  for (const fits of steps) {
    const used = new Set(out);
    for (const k of keys) {
      if (used.has(k)) continue;
      const hits = top.flatMap((e, i) => (!out[i] && fits(k, e) ? [i] : []));
      if (hits.length === 1) out[hits[0]] = k;
    }
  }
  return out;
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

/** Aliases left out by the hygiene rules, counted by reason (and listed in $ALIAS_LOG, if set, for review). */
const DROPS = new Map<string, number>();
const dropLog: string[] = [];

function logDrop(id: string, rank: number, name: string, alias: string, why: string): void {
  const reason = why.replace(/ \(".*"\)$/, "");
  DROPS.set(reason, (DROPS.get(reason) ?? 0) + 1);
  dropLog.push([id, rank, name, alias, why].join("\t"));
}

/**
 * The puzzle as written: the shared format plus the topic's category (daily rotation and the list judge read it)
 * and whether a lower number ranks higher.
 */
type BuiltPuzzle = Puzzle & { category: Topic["category"]; lowerIsBetter?: true };

async function buildPuzzle(topic: Topic): Promise<BuiltPuzzle> {
  const rows = (await readRows(topic)).slice(0, MAX_ROWS);
  if (rows.length < 10) throw new Error(`only ${rows.length} rows`);
  if (rows.length > 10 && sameValue(rows[9], rows[10])) {
    throw new Error(`tie at #10/#11: ${rows[9].name} / ${rows[10].name}`);
  }

  const facts = readFacts(topic.id);
  const entries: Entry[] = [];
  for (const [i, row] of rows.entries()) {
    const aliases = new Set(row.aliasSeeds);
    const redirects = topic.noRedirects ? [] : await fetchRedirects(row.redirectTarget, i >= 10);
    const ctx = {
      names: [row.name, row.redirectTarget, ...row.aliasSeeds],
      forms: redirects,
      works: topic.works,
      webNames: topic.webNames,
    };
    for (const raw of redirects) {
      const r = baseTitle(raw);
      // A redirect from another country's name ("China" to Taiwan) would hand that name to the wrong entry.
      const n = normalize(r);
      if (COUNTRY_NAMES.has(n) && n !== normalize(row.name)) continue;
      if (blockedAlias(r, [row.name])) {
        logDrop(topic.id, i + 1, row.name, raw, "a slur or an insult");
        continue;
      }
      // Not a name for the thing: "Child abuse in Saudi Arabia", "1937 Nanga Parbat tragedy", a song from a musical.
      const why = junkRedirect(raw, ctx);
      if (why) {
        logDrop(topic.id, i + 1, row.name, raw, why);
        continue;
      }
      aliases.add(r);
    }
    for (const a of topic.aliases?.[row.name] ?? []) aliases.add(a);
    if (topic.people) {
      // "Bryant", not "Park" (Linkin Park) or "Brown": a surname that is a plain word means other things.
      const last = row.name.split(" ").at(-1)!;
      if (last.length >= 4 && !isEnglishWord(normalize(last))) aliases.add(last);
    }
    // A tie below the top 10 shares its rank, as the source writes it ("T20"): Everland is #20 with Disney Adventure
    // World, not #21. Each top-10 slot keeps its own rank (a tie at #10/#11 is rejected above), and a table kept in
    // its own order has broken its ties already.
    const tied = i >= 10 && !topic.keepOrder && sameValue(row, rows[i - 1]);
    entries.push({
      rank: tied ? entries[i - 1].rank : i + 1,
      name: row.name,
      aliases: [...aliases],
      value: (topic.prefix ?? "") + row.valueText + (topic.unit ?? ""),
      ...(Number.isFinite(row.value) ? { n: statNumber(row.value) } : {}),
      ...(i < 10 ? { article: row.redirectTarget } : {}),
    });
  }
  const top = entries.slice(0, 10);
  const factKeys = matchFacts(facts, top);
  for (const [i, e] of top.entries()) if (factKeys[i]) e.fact = facts[factKeys[i]!];
  const unused = Object.keys(facts).filter((k) => !factKeys.includes(k));
  if (unused.length) console.log(`warn ${topic.id}: facts for ${unused.map((k) => `"${k}"`).join(", ")} match no top-10 answer`);

  // Unranked but real: rows from other tables, and members of the topic's universe (every country, every
  // state, every team) that the table leaves out, still count as (wrong) answers.
  seedIntent(topic, entries);
  const extra = await readAlso(topic, rows.at(-1)!.value);
  for (const u of [topic.universe ?? []].flat()) {
    // A free row's other names count too: the table's "Macau" is the universe's "Macao".
    const free = new Set(unrankedRows(topic));
    for (const forms of COUNTRY_FORMS) if (forms.some((f) => free.has(normalize(f)))) for (const f of forms) free.add(normalize(f));
    const members = UNIVERSES[u]().filter((p) => !topic.skip?.includes(p.name) && ![p.name, ...p.aliases].some((f) => free.has(normalize(f))));
    extra.push(...members.map((p) => ({ rank: 0, ...p })));
  }
  // Every form an entry so far is known by, and that entry: a later namesake is the same answer.
  const taken = new Map<string, Entry>();
  const take = (form: string, e: Entry) => taken.has(normalize(form)) || taken.set(normalize(form), e);
  for (const e of entries) for (const f of [e.name, ...e.aliases]) take(f, e);
  // The same thing written another way ("St. Lawrence River" for the ranked Saint Lawrence, the table's link
  // "Javary River" for Javari) is one entry: the other spelling becomes an alias instead of a second, unranked entry.
  const owner = new Map<string, Entry>();
  const own = (e: Entry, forms: (string | undefined)[]) => {
    for (const f of forms) if (f && sameKey(f) && !owner.has(sameKey(f))) owner.set(sameKey(f), e);
  };
  for (const [i, e] of entries.entries()) own(e, [e.name, ...e.aliases, rows[i].redirectTarget, rows[i].link]);
  for (const e of extra) {
    const forms = ownForms(e).map(normalize).filter(Boolean);
    const known = forms.find((f) => taken.has(f));
    if (known) {
      // The same answer in another dated table: the latest figure is the one to show (New York City keeps its
      // 2023 rank, not 2018's).
      adoptDated(taken.get(known)!, e);
      continue;
    }
    // Add-ons of an entry already listed ("Skyrim – Dragonborn" next to Skyrim) only blur what its name means.
    const base = e.name.split(" – ")[0];
    if (base !== e.name && taken.has(normalize(base))) continue;
    const same = [...ownForms(e), ARTICLE.get(e), LINK.get(e)].map((f) => f && owner.get(sameKey(f))).find(Boolean);
    if (same) {
      if (!same.aliases.includes(e.name)) same.aliases.push(e.name);
      if (same.n === undefined && e.n !== undefined) Object.assign(same, { value: e.value, n: e.n });
      else adoptDated(same, e);
      take(e.name, same);
      console.log(`     ${topic.id}: "${e.name}" is ${same.rank ? `#${same.rank} ` : ""}"${same.name}"`);
      continue;
    }
    entries.push(e);
    take(e.name, e);
    own(e, [e.name, ARTICLE.get(e), LINK.get(e)]);
  }

  const junkList = [
    ...(topic.junkAliases ?? []),
    ...(hasCountries(topic) ? COUNTRY_JUNK : []),
    ...(/\bcities\b/.test(topic.noun) ? CITY_JUNK : []),
    ...(topic.webNames ? COMPANY_JUNK : []),
    ...(topic.people || /\b(accounts|pages)\b/.test(topic.noun) ? CELEBRITY_JUNK : []),
  ];
  if (junkList.length) {
    const junk = new Set(junkList.map(normalize));
    for (const e of entries) {
      for (const a of e.aliases) if (junk.has(normalize(a))) logDrop(topic.id, e.rank, e.name, a, "listed in junkAliases");
      e.aliases = e.aliases.filter((a) => !junk.has(normalize(a)));
    }
  }
  const namesakes = new Map<string, Set<Entry>>();
  for (const [i, r] of rows.entries()) {
    if (r.plain) namesakes.set(normalize(r.plain), (namesakes.get(normalize(r.plain)) ?? new Set()).add(entries[i]));
  }
  pruneAliases(entries, namesakes);
  applyIntent(topic, entries);
  // Whatever the source (redirect, cell, universe), a slur never ships.
  for (const e of entries) e.aliases = e.aliases.filter((a) => !blockedAlias(a, [e.name]));
  if (topic.values) {
    const [found, tried] = await addValues(topic, entries, articleOf, rows.map((r) => r.value));
    console.log(`     ${topic.id}: values for ${found} of ${tried} likely unranked answers`);
  }
  const dataAsOf = await dataDate(topic);

  return {
    id: topic.id,
    title: topic.title,
    prompt: topic.prompt,
    noun: topic.noun,
    category: topic.category,
    metric: topic.metric,
    ...(topic.lowerIsBetter ? { lowerIsBetter: true as const } : {}),
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

type IndexEntry = { id: string; title: string; category: string; blitz: boolean };

/**
 * The index after building some lists: every list already indexed stays, the ones just built are updated or added,
 * all in topic order (lists topics.ts no longer has keep their place at the end).
 */
export function mergeIndex(old: IndexEntry[], built: IndexEntry[]): IndexEntry[] {
  const byId = new Map(old.map((e) => [e.id, e]));
  for (const e of built) byId.set(e.id, e);
  const order = new Map(TOPICS.map((t, i) => [t.id, i]));
  const at = (e: IndexEntry) => order.get(e.id) ?? TOPICS.length;
  return [...byId.values()].sort((a, b) => at(a) - at(b));
}

// `--test` builds only the test set (fast iteration) and indexes just those lists; ids build only those ids (and
// update their index entries); no arguments builds everything.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const testMode = args.includes("--test");
  // Test mode also builds every list on the daily schedule, so scheduled dailies always exist and are indexed.
  const scheduled: string[] = existsSync(join(OUT_DIR, "daily.json"))
    ? JSON.parse(readFileSync(join(OUT_DIR, "daily.json"), "utf8")).map((e: { id: string }) => e.id)
    : [];
  const only = testMode ? [...new Set([...TEST_SET, ...scheduled])] : args.filter((a) => !a.startsWith("--"));
  mkdirSync(OUT_DIR, { recursive: true });
  const index: IndexEntry[] = [];
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
  const indexFile = join(OUT_DIR, "index.json");
  if (!only.length || testMode) writeFileSync(indexFile, JSON.stringify(index, null, 1));
  else if (existsSync(indexFile)) {
    writeFileSync(indexFile, JSON.stringify(mergeIndex(JSON.parse(readFileSync(indexFile, "utf8")), index), null, 1));
  }
  const dropped = [...DROPS].sort((a, b) => b[1] - a[1]).map(([why, n]) => `${n} ${why}`);
  console.log(`aliases dropped: ${dropped.join("; ") || "none"}`);
  if (process.env.ALIAS_LOG) writeFileSync(process.env.ALIAS_LOG, dropLog.join("\n") + "\n");
  console.log(`lexicon trained on ${writeLexicon(OUT_DIR)}`);
  console.log(`${requestCount()} Wikipedia requests (the rest came from the cache)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
