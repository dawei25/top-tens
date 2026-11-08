// Builds public/puzzles/*.json from the Wikipedia tables listed in topics.ts.
// Usage: npm run build:puzzles [-- topic-id ...]
import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry, Fact, Puzzle } from "../src/game/types";
import { normalize } from "../src/game/match";
import { cleanText, splitHeader, statNumber, tableGrid, wikitables, type Cell } from "./table";
import { TEST_SET, TOPICS, type Also, type Dated, type Topic } from "./topics";
import { fetchCategory, fetchPage, fetchRedirects, NotFound, pageUrl, requestCount } from "./wiki";
import { addValues } from "./values";
import { KNOWN_DIR, writeLexicon } from "./lexicon";
import { tableDataDate } from "./dates";
import { CITY_FORMS, COUNTRY_FORMS, INTENT, NICKNAMES, STATE_FORMS } from "./intent";

/** Postal codes that are everyday words: never aliases. */
const WORD_CODES = new Set(["IN", "OR", "ME", "HI", "OK", "OH"]);
import { countryOf, UNIVERSES, US_STATE_CODES, whereIs, type Place, type Region, type Where } from "./gazetteer";
import { bareWord, baseTitle, blockedAlias, CELEBRITY_JUNK, CITY_JUNK, COMPANY_JUNK, COUNTRY_JUNK, isEnglishWord, junkRedirect, mangledForms, placeholderName } from "./aliases";

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
/** Aliases an unranked entry only has as short forms cut from its name ("Demon Slayer"), not as a name its cell says. */
const SHORT = new WeakMap<Entry, Set<string>>();
/** Entries from a topic's categories, whose ARTICLE is the member's own title. */
const FROM_CATEGORY = new WeakSet<Entry>();
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
  // A numbered part is a different thing: "Bridgerton (Season 3)" is not "Bridgerton (Season 1)".
  const part = name.match(/\(([^()]+)\)\s*$/)?.[1];
  const kept = part && NUMBERED_PART.test(part.trim()) ? `${baseTitle(name)} ${part}` : baseTitle(name);
  const words = normalize(kept.replace(/[ʻʼ`'’]/g, ""))
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
  /** False: `redirectTarget` is only the row's article (the whole show of a lower season), not a source of aliases. */
  redirects?: false;
  /** The article the name cell links, even when it isn't used for redirects. */
  link?: string;
  /**
   * A row that is one part of a thing (`part` in topics.ts): the thing's name, the part's own article, and whether
   * a higher-ranked part of the same thing holds the name.
   */
  part?: { base: string; link?: string; lower?: true };
  /** What tells this row apart from another row with the same name: its year or its article's qualifier. */
  tag?: string;
  /** The name it shares with such a namesake ("The Lion King" for "The Lion King (1994)"). */
  plain?: string;
  /** The countries the row is in (`countryCol`), as the country lists name them. */
  country?: string[];
}

/** An entry as built: the puzzle format, plus the countries a place is in where the topic reads them. */
type BuiltEntry = Entry & { country?: string | string[] };

/**
 * The countries a cell names, one per line, as the countries universe names them: "Republic of Ireland" is Ireland,
 * "Danish Realm" Denmark, "Timor-Leste" East Timor. Asides ("(Kingdom of Denmark)") and unknown names are left out;
 * the unknown ones are listed for gazetteer.ts or COUNTRY_FORMS.
 */
export function cellCountries(cell: Pick<Cell, "lines" | "text"> | undefined, unknown?: Set<string>): string[] {
  const out: string[] = [];
  for (const line of cell?.lines.length ? cell.lines : [cell?.text ?? ""]) {
    const name = cleanName(line);
    if (!name) continue;
    const c = countryOf(name)?.name;
    if (!c) unknown?.add(name);
    else if (!out.includes(c)) out.push(c);
  }
  return out;
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

/**
 * A person's surname as a short form: "Bryant", not "Park" (Linkin Park) or "Brown": a surname that is a plain word
 * means other things. Undefined for one-word names and short surnames.
 */
function surname(name: string): string | undefined {
  const words = name.split(" ");
  const last = words.at(-1)!;
  return words.length > 1 && last.length >= 4 && !isEnglishWord(normalize(last)) ? last : undefined;
}

function addSurname(e: Entry): void {
  const last = surname(e.name);
  if (last && !e.aliases.includes(last)) e.aliases.push(last);
}

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
/** Also a stand-in for a title not announced yet ("Untitled ... series", "Awaiting release"). */
export const skipName = (name: string) => SKIP_NAME.test(name) || TOTAL_ROW.test(name) || placeholderName(name);

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
/** Universes whose members' other names are nicknames ("Cubs"), which every row naming the team takes. */
export const TEAM_UNIVERSE = /-teams$/;

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
/** Rows whose count is zero (a team with no titles), by normalized name: shown as "0" when guessed, never ranked. */
const ZERO_ROWS = new Map<string, Map<string, string>>();
const zeroRows = (topic: Topic) => ZERO_ROWS.get(topic.id) ?? ZERO_ROWS.set(topic.id, new Map()).get(topic.id)!;

/** Where a topic's ranked rows come from: its page's tables, then its other `pages`' (one ranking split by region). */
export const rankedSources = (topic: Pick<Topic, "page" | "tables" | "pages">) => [{ page: topic.page, tables: topic.tables }, ...(topic.pages ?? [])];

/**
 * Puts rows in ranking order: the biggest number first, or the smallest for a `lowerIsBetter` list (the smallest
 * countries); the higher tiebreak first either way. A `keepOrder` table has ranked them already.
 */
export function rankRows<R extends Pick<Row, "value" | "tiebreak">>(topic: Pick<Topic, "keepOrder" | "lowerIsBetter">, rows: R[]): R[] {
  if (topic.keepOrder) return rows;
  const dir = topic.lowerIsBetter ? -1 : 1;
  return rows.sort((a, b) => dir * (b.value - a.value) || (b.tiebreak ?? 0) - (a.tiebreak ?? 0));
}

export async function readRows(topic: Topic): Promise<Row[]> {
  const rows: Row[] = [];
  const members = topic.canonical ? [topic.universe ?? []].flat().flatMap((u) => UNIVERSES[u]()) : [];
  /** `countryCol` cells that name no known country. */
  const unknownCountries = new Set<string>();
  for (const source of rankedSources(topic)) {
    const $ = await fetchPage(source.page);
    const tables = wikitables($);
    for (const t of source.tables) {
      if (!tables[t]) throw new Error(`${source.page} has no table ${t}`);
      const { header, body } = splitHeader(tableGrid($, tables[t]));
      const nc = column(header, topic.name);
      const vc = column(header, topic.value);
      const tc = topic.tiebreak === undefined ? -1 : column(header, topic.tiebreak);
      const aliasCs = (topic.aliasCols ?? []).map((a) => column(header, a));
      const fromCol = topic.fallback ? column(header, topic.fallback.from) : -1;
      const yc = header.findIndex((h) => /^(year|released?|release date)\b/i.test(h));
      const pc = topic.part === undefined ? -1 : column(header, topic.part);
      const ccol = topic.countryCol === undefined ? -1 : column(header, topic.countryCol);
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
        // One season of a show: "Squid Game (Season 2)". A part that isn't numbered ("Limited Series") is the whole thing.
        const partText = pc >= 0 ? cleanName(r[pc]?.text ?? "") : "";
        const numbered = NUMBERED_PART.test(partText);
        const base = topic.rename?.[cellText] ?? cellText;
        const name = numbered ? (topic.rename?.[`${cellText} (${partText})`] ?? `${base} (${partText})`) : base;
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
          // The Padres' "0": a guess shows it (judge, cycle 6), but a count of nothing never scores in Blitz. A "0.00"
          // is a figure too small to print (the Faroe Islands' CO2), not a zero: no figure beats a wrong one.
          else if (!/\.\d/.test(v.display)) zeroRows(topic).set(normalize(name), (topic.prefix ?? "") + v.display + (topic.unit ?? ""));
          continue;
        }
        // One name per line of the cell: "Mount Everest / Sagarmatha / Chomolungma" are three aliases, not one glued string.
        // A river system's cell ("Saint Lawrence–Niagara–Detroit–...") names other rivers after the first.
        const lines = (nameCell.lines.length > 1 ? nameCell.lines : [nameCell.text]).filter((l) => !topic.noParts || !/[–-]/.test(l));
        const seeds = [...lines, nameCell.linkText ?? "", ...shortForms(name, topic.stripWords)].map((s) =>
          topic.nameStrip ? s.replace(topic.nameStrip, "").trim() : s,
        );
        if (name !== cellText) seeds.push(cellText);
        // "Squid Game 2", as people say a season, and "Squid Game S2", as people write one.
        if (numbered) seeds.push(`${base} ${partText.match(/\d+/)![0]}`);
        if (numbered && /^(season|series)\b/i.test(partText)) seeds.push(`${base} S${partText.match(/\d+/)![0]}`);
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
        // A season's article is its show's (the name cell's link), else its own (the season cell's).
        const partTarget = numbered ? (nameCell.link ? viaCell : r[pc]?.link) : undefined;
        const target =
          topic.articles?.[name] ?? partTarget ?? (viaCell !== cellText ? viaCell : redirectTarget(name, nameCell, hasCountries(topic)));
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
          ...(numbered ? { part: { base, link: r[pc]?.link } } : {}),
          ...(ccol >= 0 ? { country: cellCountries(r[ccol], unknownCountries) } : {}),
        });
      }
    }
  }
  for (const name of Object.keys(topic.overrides ?? {})) {
    if (!rows.some((r) => r.name === (topic.rename?.[name] ?? name))) console.log(`warn ${topic.id}: override for "${name}", which is not a row`);
  }
  if (unknownCountries.size) console.log(`warn ${topic.id}: country cells naming no known country (gazetteer.ts): ${[...unknownCountries].join(", ")}`);
  rankRows(topic, rows);
  lowerParts(rows);
  // "3.2 million" among "6,301,972"s reads as another unit: write it out like the rest, keeping its currency sign
  // ("$940.3 million" is "$940,300,000", not "940,300,000").
  const worded = rows.filter((r) => /\b(million|billion|trillion)$/.test(r.valueText));
  if (worded.length && worded.length < rows.length / 2) {
    for (const r of worded) r.valueText = (r.valueText.match(/^[$€£]/)?.[0] ?? "") + Math.round(r.value).toLocaleString("en-US");
  }
  return distinctRows(topic, rows);
}

/** A part cell that numbers the part: "Season 2", "Part 3", "Series 1", "Volume 2". */
const NUMBERED_PART = /^(season|series|part|volume|vol\.?|chapter|book)\s*\d+$/i;

/**
 * Parts of one thing (seasons of a show, best first): the thing's own name, its article and that article's
 * redirects belong to its highest-ranked part, so "squid game" is Season 1 (#1). The other parts are named with
 * their number ("squid game season 2", "squid game 2") and take their own article's redirects, if they have one.
 */
export function lowerParts<R extends Pick<Row, "part" | "aliasSeeds" | "redirectTarget" | "redirects" | "link">>(rows: R[]): void {
  const first = new Map<string, R>();
  for (const r of rows) {
    if (!r.part) continue;
    const base = normalize(r.part.base);
    const top = first.get(base);
    if (!top) {
      first.set(base, r);
      continue;
    }
    r.part.lower = true;
    r.aliasSeeds = r.aliasSeeds.filter((s) => normalize(s) !== base);
    r.link = r.part.link;
    if (r.part.link) r.redirectTarget = r.part.link;
    else {
      // No article of its own: the show's is its article, but the show's redirects are the top season's names.
      r.redirectTarget = top.redirectTarget;
      r.redirects = false;
    }
  }
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

/**
 * The latest year (or span) a cell names: "3 (2023, 2025, 2026)" is 2026, the last time it happened; a lone span
 * ("2018–2019") stays whole.
 */
export function lastYear(text: string): string {
  return [...text.matchAll(new RegExp(YEARS.source, "g"))].at(-1)?.[0] ?? text;
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

/**
 * The names and figures a cell lists (`counts` in topics.ts): "New York City (324), Jersey City (22), Fort Lee (2)",
 * "Burnaby (17), Vancouver (7), Coquitlam (4). New Westminster (1)".
 */
export function countedNames(text: string): { name: string; figure: string }[] {
  return [...text.matchAll(/([^,;()]+?)\s*\((\d[\d,]*(?:\.\d+)?)\)/g)]
    .map((m) => ({ name: m[1].replace(/^[\s.]+/, "").trim(), figure: m[2] }))
    .filter((c) => c.name);
}

/** A figure at the end of a name cell: "Tencent 688,000", "ExxonMobil 356,548.7". */
const FIGURE_END = /\s+(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+)\s*$/;

/** A table's caption, else the heading above it. */
function tableTitle($: Awaited<ReturnType<typeof fetchPage>>, table: Parameters<typeof tableDataDate>[1]): string {
  return cleanText($(table).find("caption").first().text()) || cleanText($(table).prevAll("h2, h3, h4, div.mw-heading").first().text());
}

/**
 * A place outside the region met again inside it (a world table's city, then the same name in a European one):
 * the region's reading wins on a regional list, so it is an answer, with the region's figure if it has one.
 */
function inRegionWins(owner: Entry, e: Entry): void {
  if (!owner.elsewhere || e.elsewhere) return;
  delete owner.elsewhere;
  if (owner.n === undefined && e.n !== undefined) Object.assign(owner, { value: e.value, n: e.n });
  else if (owner.value === undefined && e.value !== undefined) owner.value = e.value;
}

/**
 * Gives an answer a dated value from a namesake row of a later `dated` table (or another source's), when the
 * answer is unranked and has no figure of its own or only an older dated one. The first table listed wins a tie.
 */
function adoptDated(owner: Entry, e: Entry): void {
  const year = DATED.get(e);
  if (year === undefined || owner.rank !== 0 || owner.n !== undefined) return;
  const had = DATED.get(owner);
  // `largest` tables: of two figures from the same year, the bigger.
  const [mine, theirs] = [LARGEST.get(owner), LARGEST.get(e)];
  const bigger = had === year && mine !== undefined && theirs !== undefined && theirs > mine;
  if (owner.value !== undefined && (had === undefined || had >= year) && !bigger) return;
  owner.value = e.value;
  DATED.set(owner, year);
  if (theirs !== undefined) LARGEST.set(owner, theirs);
  else LARGEST.delete(owner);
}

/** The figure of an entry from a `largest` dated table, to compare with another one's. */
const LARGEST = new WeakMap<Entry, number>();

/** A table's column naming each row's country. */
const COUNTRY_COLUMN = /^(country|member state|sovereign state)\b/i;

/**
 * Where a regional topic (`region`) puts another page's table: a column whose country places each row, or one
 * place for the whole table: "inside" (no region, the topic's own page, or one country in the region), "outside"
 * (one country outside it: every row is `elsewhere`) or "unsure" (a transcontinental country: no row). A table that
 * says neither is an error: it would take in the world as the region's.
 */
export function regionColumn(topic: Pick<Topic, "id" | "page" | "region">, src: Pick<Also, "page" | "country">, header: string[], t: number): number | Where {
  if (!topic.region || (src.page ?? topic.page) === topic.page) return "inside";
  if (src.country) {
    const where = whereIs(src.country, topic.region);
    if (!where) throw new Error(`${topic.id}: country "${src.country}" of ${src.page} is no country`);
    return where;
  }
  const cc = header.findIndex((h) => COUNTRY_COLUMN.test(h));
  if (cc < 0) throw new Error(`${topic.id}: ${src.page} table ${t} says no country (give it \`country\`), so it can't be kept to ${topic.region}`);
  return cc;
}

/** A title's name without its qualifier: "Toledo, Ohio" → Toledo, "Valencia (Venezuela)" → Valencia. */
const titleHead = (title: string) => title.split(/,| \(/)[0].trim();

/**
 * A place whose table links its name with a qualifier ("Toledo, Ohio", "Kingston, Jamaica"): Wikipedia gives the
 * bare name to another article (a disambiguation page, or Toledo in Spain), which regionalNamesake then reads.
 * "Washington D.C." linking "Washington, D.C." is the same name, not a qualified one.
 */
export const qualifiedLink = (name: string, link?: string) =>
  !!link && link !== name && !/\(page does not exist\)/.test(link) && normalize(titleHead(link)) === normalize(name);

/** Descriptions of places nobody names on a list of cities: a namesake village doesn't make "Arlington" European. */
const MINOR_PLACE = /\b(village|hamlet|parish|suburb|neighbou?rhood|locality|ward|unincorporated|ghost town|census-designated|townland)\b/i;

/** A heading element's text: the h2-h5 itself, or the one inside a `div.mw-heading` wrapper. */
function headingText($: CheerioAPI, h: AnyNode): string {
  const hx = $(h).is("h2, h3, h4, h5") ? $(h) : $(h).find("h2, h3, h4, h5").first();
  return cleanText(hx.text());
}

/**
 * The headings a list item sits under, nearest first ("England", then "United Kingdom"): its `section`s' headings
 * in Wikipedia's page HTML, else the headings before its block in flat markup.
 */
function sectionTitles($: CheerioAPI, li: AnyNode): string[] {
  const out: string[] = [];
  $(li)
    .parents("section")
    .each((_, s) => {
      const h = $(s).children("div.mw-heading, h2, h3, h4, h5").first();
      if (h.length) out.push(headingText($, h[0]));
    });
  if (out.length) return out;
  let level = 7;
  $(li)
    .parentsUntil(".mw-parser-output")
    .last()
    .prevAll("div.mw-heading, h2, h3, h4, h5")
    .each((_, h) => {
      const hx = $(h).is("h2, h3, h4, h5") ? $(h) : $(h).find("h2, h3, h4, h5").first();
      const l = Number((hx.prop("tagName") ?? "H7").slice(1));
      if (l >= level) return;
      level = l;
      out.push(headingText($, h));
    });
  return out;
}

/**
 * Whether a piece of text names a country inside the region ("Spain", "Scotland"), or is the region ("Europe");
 * with `edge`, a transcontinental country reaching it counts too (Russia for Saint Petersburg). A list's line
 * doesn't take the edge: its "Georgia" is as often the US state.
 */
function namesRegion(text: string, region: Region, edge = false): boolean | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (normalize(t) === normalize(region)) return true;
  const where = countryOf(t) && whereIs(t, region);
  return where ? where === "inside" || (edge && where === "unsure") : undefined;
}

/**
 * Whether Wikipedia's page for a bare place name gives the name to a place inside the region, so a guess of it may
 * mean that place: the article itself (its infobox's country: Valencia is Spain's, St. Petersburg Russia's), or a
 * disambiguation page's place titled with the name and a qualifier ("Toledo, Spain", "Hamilton, South Lanarkshire")
 * whose qualifier or line names a country in the region, else whose section does. Villages and suburbs don't count
 * (MINOR_PLACE), nor other things of the name ("The Phoenix (magazine), Ireland").
 */
export function regionalNamesake($: CheerioAPI, name: string, region: Region): boolean {
  const infoboxCountry = $("table.infobox tr")
    .filter((_, tr) => /^(country|sovereign state)$/i.test(cleanText($(tr).find("th").first().text())))
    .map((_, tr) => cleanText($(tr).find("td").first().text()))
    .get();
  if (infoboxCountry.some((c) => namesRegion(c, region, true))) return true;
  const listing = $("#disambigbox, .dmbox, .setindexbox").length > 0 || /disambiguation|set index/i.test($("#catlinks").text());
  if (!listing) return false;
  return $(".mw-parser-output li")
    .toArray()
    .some((li) => {
      const title = $(li).find("a").first().attr("title") ?? "";
      // A place's article: the name, a comma, where it is.
      if (!title.includes(",") || normalize(titleHead(title)) !== normalize(name)) return false;
      // The item's own line (a nested list's lines are other items), without asides: "Scotland (formerly Cadzow)".
      const line = cleanText($(li).clone().children("ul, ol").remove().end().text()).replace(/\([^)]*\)/g, "");
      if (MINOR_PLACE.test(line)) return false;
      const parts = [...title.split(",").slice(1), ...line.split(/,|\bin\b|\bof\b/)];
      const own = parts.map((p) => namesRegion(p, region)).filter((w) => w !== undefined);
      if (own.length) return own.includes(true);
      const section = sectionTitles($, li).map((s) => namesRegion(s, region)).find((w) => w !== undefined);
      return section === true;
    });
}

/** Names of places outside a topic's region left free for being a place inside it too (see regionalNamesake). */
const SHARED_NAMES = new Map<string, Set<string>>();
const sharedNames = (topic: Topic) => SHARED_NAMES.get(topic.id) ?? SHARED_NAMES.set(topic.id, new Set()).get(topic.id)!;
/** Bare names already looked up, per region: one page read per name however many tables link it. */
const NAMESAKES = new Map<string, boolean>();

/** Whether a place outside the region shares its name with one inside it (Toledo, Ohio and Toledo, Spain). */
async function hasRegionalNamesake(name: string, link: string | undefined, region: Region): Promise<boolean> {
  if (!qualifiedLink(name, link)) return false;
  const key = `${region}\t${normalize(name)}`;
  if (!NAMESAKES.has(key)) {
    let found = false;
    try {
      found = regionalNamesake(await fetchPage(name), name, region);
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
    }
    NAMESAKES.set(key, found);
  }
  return NAMESAKES.get(key)!;
}

/**
 * Unranked accepted answers from other tables (or pages): aliases from the cell and short forms, and the list's
 * stat when the source has a `value` column for it (only below `limit`, the last ranked row's number), or a rank
 * and figure from another year's table (`dated`).
 */
async function readAlso(topic: Topic, limit: number): Promise<Entry[]> {
  const out: Entry[] = [];
  let unsure = 0;
  /** Country cells that name no known country (left out): give them their country in gazetteer.ts. */
  const unknown = new Set<string>();
  for (const src of topic.also ?? []) {
    const $ = await fetchPage(src.page ?? topic.page);
    const tables = wikitables($);
    for (const t of src.tables) {
      const { header, body } = splitHeader(tableGrid($, tables[t]));
      // A regional list takes another page's rows as its region's answers or as `elsewhere` (the source page's own
      // are its scope): a whole table by its `country`, else row by row by the table's Country column.
      const placed = regionColumn(topic, src, header, t);
      const cc = typeof placed === "number" ? placed : -1;
      if (placed === "unsure") {
        unsure += body.length;
        continue;
      }
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
        if (src.counts) {
          if (topic.region) throw new Error(`${topic.id}: \`counts\` sources can't be kept to a region`);
          for (const c of countedNames(cell.text)) {
            const name = src.rename?.[c.name] ?? c.name;
            if (!normalize(name) || skipName(name) || topic.skip?.includes(name) || src.skip?.includes(name)) continue;
            const entry: Entry = { rank: 0, name, aliases: [] };
            const v = parseValue(c.figure);
            if (v && v.value > 0 && v.value < limit) {
              entry.value = (topic.prefix ?? "") + v.display + (topic.unit ?? "");
              entry.n = statNumber(v.value);
            }
            out.push(entry);
          }
          continue;
        }
        let where: Where | undefined = typeof placed === "number" ? undefined : placed;
        if (cc >= 0) {
          const country = cleanName(r[cc]?.text ?? "");
          where = whereIs(country, topic.region!);
          if (!where) {
            if (country) unknown.add(country);
            continue;
          }
          if (where === "unsure") {
            unsure++;
            continue;
          }
        }
        // "Tencent 688,000": the figure follows the name in the same cell.
        const glued = src.dated?.figureInName ? cell.text.match(FIGURE_END) : null;
        const unglue = (s: string) => (src.dated?.figureInName ? s.replace(FIGURE_END, "") : s);
        const named = unglue(cellName(cell, src));
        const raw = familyName(named, cell.text);
        const name = src.rename?.[raw] ?? raw;
        if (!name || !normalize(name) || skipName(name)) continue;
        if (topic.skip?.includes(name) || src.skip?.includes(name)) continue;
        if (!topic.numberNames && /\d{3,}.*\d{3,}/.test(name)) continue;
        if (where === "outside" && (await hasRegionalNamesake(name, cell.link, topic.region!))) {
          sharedNames(topic).add(name);
          continue;
        }
        // A family row's text ("Karl and Theo Albrecht") names several people: not an alias of one of them.
        const family = raw !== named;
        const lines = family ? [] : (cell.lines.length > 1 ? cell.lines : [cell.text]).map(unglue);
        const others = aliasCs.flatMap((c) => (r[c] ? [r[c].linkText ?? "", ...r[c].lines.flatMap((l) => l.split("/")).map((p) => p.split(",")[0])] : []));
        const aliases = [...lines, family ? "" : cell.linkText ?? "", ...shortForms(name, topic.stripWords), ...others].map(cleanName);
        const entry: Entry = { rank: 0, name, aliases: aliases.filter((a) => a && a !== name) };
        // A place outside the region: a costly miss that says so ("Tokyo isn't in Europe."), with no figure.
        if (where === "outside") entry.elsewhere = true;
        const v = entry.elsewhere || topic.lowerIsBetter ? null : glued ? parseValue(glued[1]) : vc >= 0 ? parseValue(r[vc]?.text ?? "") : null;
        const label = perYear ? datedLabel(src.dated!, [lastYear(r[yc]?.text ?? "")], "") : tableLabel;
        if (src.dated && label && !entry.elsewhere) {
          const d = src.dated;
          const sign = d.prefix ?? v?.display.match(/^[$€£]/)?.[0] ?? "";
          const digits = v && (d.scale ? scaledFigure(v.value, d.scale) : v.display.replace(/^[$€£]/, ""));
          const figure = d.figure ?? (v && v.value > 0 ? sign + digits + (d.unit ?? topic.unit ?? "") : undefined);
          const shown = datedValue(label, rc >= 0 ? rankOf(r[rc]?.text) : perYear?.rank, figure, d.source);
          if (shown) {
            entry.value = shown;
            DATED.set(entry, labelYear(label));
            if (d.largest && v) LARGEST.set(entry, v.value);
          }
        } else if (!src.dated && v && v.value > 0 && v.value < limit) {
          entry.value = (topic.prefix ?? "") + v.display + (topic.unit ?? "");
          entry.n = statNumber(v.value);
        }
        ARTICLE.set(entry, family ? name : redirectTarget(name, cell, hasCountries(topic)));
        LINK.set(entry, cell.link);
        COLUMN_ALIASES.set(entry, new Set(others.map(cleanName).filter((a) => a && !lines.map(cleanName).includes(a))));
        // Compared normalized: "Lion King" cut from "The Lion King" is the name itself.
        const said = new Set([name, ...lines, cell.linkText ?? ""].map((s) => normalize(cleanName(s))));
        SHORT.set(entry, new Set(shortForms(name, topic.stripWords).map(cleanName).filter((s) => s && !said.has(normalize(s)))));
        out.push(entry);
      }
    }
  }
  if (unsure) console.log(`     ${topic.id}: ${unsure} rows of other pages in transcontinental countries left out (free)`);
  const shared = [...sharedNames(topic)];
  if (shared.length) console.log(`     ${topic.id}: ${shared.length} places outside ${topic.region} named like one inside left out (free): ${shared.join(", ")}`);
  if (unknown.size) console.log(`warn ${topic.id}: rows in no known country left out (gazetteer.ts): ${[...unknown].join(", ")}`);
  for (const cat of topic.universeCategories ?? []) {
    const cap = topic.categoryCap ?? CATEGORY_CAP;
    const titles = await fetchCategory(cat, topic.categoryDepth ?? 0, cap);
    if (!titles.length) console.log(`warn ${topic.id}: category "${cat}" is empty or missing`);
    const cut = capWarning(topic.id, cat, titles, cap);
    if (cut) console.log(cut);
    for (const title of titles) {
      if (CATEGORY_SKIP.test(title) || topic.categorySkip?.test(title) || topic.skip?.includes(title)) continue;
      if (topic.categoryNames && !looksLikeName(baseTitle(title))) continue;
      const cleaned = cleanName(title);
      const name = topic.categoryRename?.[title] ?? cleaned;
      if (!normalize(name) || skipName(name)) continue;
      // The title's qualifier ("Ben Taylor (first baseman, born 1888)") is nothing a player types; a renamed
      // member keeps its title as an alias, unless that is junk here ("Pointer" is a type of dog, not one breed).
      const entry: Entry = { rank: 0, name, aliases: [baseTitle(title)].filter((a) => a !== name && !topic.junkAliases?.includes(a)) };
      ARTICLE.set(entry, title);
      FROM_CATEGORY.add(entry);
      out.push(entry);
    }
  }
  for (const [name, aliases] of Object.entries(topic.more ?? {})) out.push({ rank: 0, name, aliases: [...aliases] });
  for (const [name, c] of Object.entries(topic.cited ?? {})) {
    if (!(c.n < limit)) throw new Error(`cited "${name}": ${c.n} is not below the last ranked row's ${limit}`);
    console.log(`     ${topic.id}: ${name} ${c.value} (${c.source})`);
    out.push({ rank: 0, name, aliases: [...c.aliases], value: c.value, n: statNumber(c.n) });
  }
  return out;
}

/**
 * The topic's `knownOnly` names (and their short forms), minus the answers' own, for the lexicon: real names that
 * aren't answers. Written to scripts/known/<id>.json.
 */
async function writeKnown(topic: Topic, entries: Entry[]): Promise<void> {
  const free = await readAlso({ ...topic, also: topic.knownOnly, more: undefined, cited: undefined, universeCategories: undefined }, Infinity);
  const answers = new Set(entries.flatMap((e) => [e.name, ...e.aliases]).map(normalize));
  // A renamed cell's own text ("Cavoodle or Cavapoo") is no name to know.
  const renamed = new Set((topic.knownOnly ?? []).flatMap((s) => Object.keys(s.rename ?? {})));
  const names = [...new Set([...free.flatMap((e) => [e.name, ...e.aliases]), ...(topic.knownNames ?? [])])].filter(
    (n) => normalize(n) && !answers.has(normalize(n)) && !renamed.has(n),
  );
  mkdirSync(KNOWN_DIR, { recursive: true });
  writeFileSync(join(KNOWN_DIR, `${topic.id}.json`), JSON.stringify(names.sort((a, b) => a.localeCompare(b)), null, 0) + "\n");
  console.log(`     ${topic.id}: ${names.length} known names that aren't answers (scripts/known)`);
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

/** Most titles taken from each of a topic's categories, unless it sets `categoryCap`. */
export const CATEGORY_CAP = 3000;

/**
 * A warning when a category filled its cap: it reads alphabetically, so the pool stopped at a letter (Premier League
 * players at "Mb", leaving out Rashford, Saka and Solskjaer). Undefined when it didn't.
 */
export function capWarning(id: string, cat: string, titles: string[], cap: number): string | undefined {
  if (titles.length < cap) return undefined;
  return `warn ${id}: category "${cat}" hit the cap of ${cap} titles at "${titles.at(-1)}": raise \`categoryCap\``;
}
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
 * King"), which belongs to them as a name does: no other entry keeps it ("Mufasa: The Lion King"). `lower`: lower
 * seasons and their show's name, which stays with the top season ("Squid Game" doesn't join Season 2).
 */
function pruneAliases(entries: Entry[], namesakes = new Map<string, Set<Entry>>(), lower = new Map<Entry, string>()): void {
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
      for (const other of names) {
        const o = byName.get(other)!;
        if (other !== own && other.startsWith(n + " ") && !n.startsWith(lower.get(o) ?? "\0")) group.add(o);
      }
      if (group.size > MAX_GROUP) continue;
      for (const g of group) if (!kept.get(g)!.has(n) && normalize(g.name) !== n) kept.get(g)!.set(n, a);
    }
  }
  for (const e of entries) e.aliases = [...kept.get(e)!.values()];
}

const COUNTRY_NAMES = new Set(UNIVERSES.countries().map((c) => normalize(c.name)));

/**
 * The full names a country goes by, for normalized forms of it: its COUNTRY_FORMS line's usual name and the
 * universe's names on that line ("cabo verde" → "cape verde", "macao" → "macau", "turkiye" → "turkey"). Not the
 * line's other forms: England is a football nation of its own beside the United Kingdom, the Olympics' ROC no Taiwan.
 */
export function countryNames(forms: string[]): string[] {
  const out: string[] = [];
  for (const line of COUNTRY_FORMS) {
    const names = [line[0], ...line.filter((f) => COUNTRY_NAMES.has(normalize(f)))].map(normalize);
    if (names.some((n) => forms.includes(n))) out.push(...names.filter((n) => !forms.includes(n)));
  }
  return out;
}

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

/**
 * Words English writes several ways, any of them in any name: "makkah royal clock tower" is the Mecca Royal Clock
 * Tower (owner, on buildings: "Mecca/Makkah spellings in general").
 */
const SPELLINGS = [
  ["Mecca", "Makkah", "Makka", "Mekka", "Mekkah"],
  ["Medina", "Madinah", "Madina"],
];

/**
 * Letters no accent-stripping turns into the ones on an English keyboard: "solskjaer" is Ole Gunnar Solskjær,
 * "odegaard" Martin Ødegaard (coverage audit, Premier League scorers).
 */
const FOLDS: Record<string, string> = {
  ø: "o", Ø: "O", æ: "ae", Æ: "Ae", ð: "d", Ð: "D", þ: "th", Þ: "Th", ł: "l", Ł: "L", đ: "d", Đ: "D", œ: "oe", Œ: "Oe",
  ß: "ss", ı: "i",
};
const FOLDABLE = `[${Object.keys(FOLDS).join("")}]`;

/** A name written with each other spelling of a SPELLINGS word in it, and with keyboard letters (FOLDS). */
export function spellingVariants(form: string): string[] {
  const out: string[] = [];
  if (new RegExp(FOLDABLE).test(form)) out.push(form.replace(new RegExp(FOLDABLE, "g"), (c) => FOLDS[c]));
  for (const set of SPELLINGS) {
    for (const w of set) {
      const re = new RegExp(`\\b${w}\\b`, "gi");
      if (re.test(form)) for (const v of set) if (v !== w) out.push(form.replace(re, v));
    }
  }
  return out;
}

/**
 * Every entry's names in the other spellings (SPELLINGS, FOLDS), unless another entry goes by that form. On a list of
 * people, a surname that changes too ("Solskjaer", "Hojlund") comes along: a surname alone is how people name a
 * player, and the name's own one wasn't typeable.
 */
function addSpellings(entries: Entry[], people = false): void {
  const owner = new Map<string, Entry>();
  for (const e of entries) for (const f of [e.name, ...e.aliases]) if (!owner.has(normalize(f))) owner.set(normalize(f), e);
  for (const e of entries) {
    const own = normalize(e.name.split(" ").at(-1)!);
    const surnames = people ? spellingVariants(e.name).map(surname).filter((s): s is string => !!s && normalize(s) !== own) : [];
    for (const v of [...[e.name, ...e.aliases].flatMap(spellingVariants), ...surnames]) {
      const n = normalize(v);
      if (owner.has(n)) continue;
      owner.set(n, e);
      e.aliases.push(v);
    }
  }
}

const FACTS_DIR = join(import.meta.dirname, "facts");

/**
 * Curated fun facts for a topic, keyed by entry name: scripts/facts/<topic id>.json. Each may also carry an
 * `evidence` quote from the article and, on a list of places, `where`: the location as the source table gives it
 * (for review; the text says it). Only text and source ship.
 */
export function readFacts(id: string): Record<string, Fact> {
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

/**
 * Whether a form two entries share is no evidence that they are one: it is a short form cut from either one's name
 * ("Demon Slayer" of "Demon Slayer: Kimetsu no Yaiba Mugen Train", "Star Wars" of "Star Wars: Episode I – The Phantom
 * Menace") and they link different articles. Then they stay apart and share the alias, and the game asks which one.
 * `forms`: the shared form, normalized and as a sameKey.
 */
export function shortFormOnly(forms: string[], short: Set<string>, otherShort: Set<string>, article?: string, otherArticle?: string): boolean {
  if (!article || !otherArticle || article === otherArticle) return false;
  return forms.some((f) => short.has(f) || otherShort.has(f));
}

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
    const redirects = topic.noRedirects || row.redirects === false ? [] : await fetchRedirects(row.redirectTarget, i >= 10);
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
    // A lower season's redirects ("Squid Game (season 2)") lose their qualifier: the bare name stays with the top one.
    if (row.part?.lower) for (const a of aliases) if (normalize(baseTitle(a)) === normalize(row.part.base)) aliases.delete(a);
    // A season's redirects can name another season ("Bridgerton season 3" on Season 1) or the show's episode and
    // season overviews ("Squid Game episodes").
    if (row.part) {
      const own = row.name.match(/\s(\d+)\)$/)?.[1];
      for (const a of aliases) {
        const n = normalize(a);
        const other = n.match(/\b(?:season|series|part|volume|vol|chapter) (\d+)\b/)?.[1];
        if ((other && other !== own) || /\b(seasons?|episodes?)$/.test(n)) aliases.delete(a);
      }
    }
    if (topic.people) {
      const last = surname(row.name);
      if (last) aliases.add(last);
    }
    // A tie below the top 10 shares its rank, as the source writes it ("T20"): Everland is #20 with Disney Adventure
    // World, not #21. Each top-10 slot keeps its own rank (a tie at #10/#11 is rejected above), and a table kept in
    // its own order has broken its ties already.
    const tied = i >= 10 && !topic.keepOrder && sameValue(row, rows[i - 1]);
    const entry: BuiltEntry = {
      rank: tied ? entries[i - 1].rank : i + 1,
      name: row.name,
      aliases: [...aliases],
      value: (topic.prefix ?? "") + row.valueText + (topic.unit ?? ""),
      ...(Number.isFinite(row.value) ? { n: statNumber(row.value) } : {}),
      ...(i < 10 ? { article: row.redirectTarget } : {}),
    };
    // One country as a string, several (an island shared by countries) as a list.
    if (row.country?.length) entry.country = row.country.length === 1 ? row.country[0] : row.country;
    SHORT.set(entry, new Set(shortForms(row.name, topic.stripWords).filter((s) => normalize(s) !== normalize(row.name))));
    entries.push(entry);
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
  // `universeNamesOnly`: the universe names the rows, but adds no answers of its own.
  // Members of a universe whose other names are nicknames (teams): those names belong to the row they merge with.
  const nicknamed = new Set<Entry>();
  // Members of the countries universe: one is the country another page's table names its usual way ("Cabo Verde" is
  // the coastline table's "Cape Verde").
  const countryMembers = new Set<Entry>();
  // A regional list's universe gives its region's members as answers and the rest as `elsewhere` (a capital by its
  // country); a transcontinental country the table leaves out, and its capital, stay free.
  const listed = new Set(rows.map((r) => countryOf(r.name)?.name).filter((n): n is string => !!n));
  const where = (p: Place) => (topic.region ? whereIs(p.country ?? p.name, topic.region, listed) : "inside");
  for (const u of topic.universeNamesOnly ? [] : [topic.universe ?? []].flat()) {
    // A free row's other names count too: the table's "Macau" is the universe's "Macao".
    const free = new Set(unrankedRows(topic));
    for (const forms of COUNTRY_FORMS) if (forms.some((f) => free.has(normalize(f)))) for (const f of forms) free.add(normalize(f));
    // A place outside the region named like one inside it is left free, as in readAlso.
    const shared = new Set([...sharedNames(topic)].map(normalize));
    const placed = UNIVERSES[u]().filter((p) => where(p) === "inside" || (where(p) === "outside" && !shared.has(normalize(p.name))));
    const members = placed.filter((p) => !topic.skip?.includes(p.name) && ![p.name, ...p.aliases].some((f) => free.has(normalize(f))));
    if (topic.region) {
      const out = members.filter((p) => where(p) === "outside").length;
      console.log(`     ${topic.id}: ${members.length - out} ${u} in ${topic.region}, ${out} elsewhere, ${UNIVERSES[u]().length - placed.length} left free`);
    }
    // Named fields only: a capital's `country` is the build's, not the puzzle format's.
    const added: Entry[] = members.map((p) => ({
      rank: 0,
      name: p.name,
      aliases: [...p.aliases],
      ...(where(p) === "outside" ? { elsewhere: true as const } : {}),
    }));
    if (TEAM_UNIVERSE.test(u)) for (const m of added) nicknamed.add(m);
    if (u === "countries") for (const m of added) countryMembers.add(m);
    extra.push(...added);
  }
  const junk = new Set(
    [
      ...(topic.junkAliases ?? []),
      ...(hasCountries(topic) ? COUNTRY_JUNK : []),
      ...(/\bcities\b/.test(topic.noun) ? CITY_JUNK : []),
      ...(topic.webNames ? COMPANY_JUNK : []),
      ...(topic.people || /\b(accounts|pages)\b/.test(topic.noun) ? CELEBRITY_JUNK : []),
    ].map(normalize),
  );
  // A junk alias is no name of the thing: the redirect "Pointer" doesn't make the article "Pointer (dog breed)" the
  // German Shorthaired Pointer, nor No Way Home's junk "Spider-Man 3" the film Spider-Man 3 (agent B, films-gross).
  const real = (e: Entry) => e.aliases.filter((a) => !junk.has(normalize(a)));
  // Every form an entry so far is known by, junk left out, and that entry: a later namesake is the same answer.
  const taken = new Map<string, Entry>();
  const take = (form: string, e: Entry) => taken.has(normalize(form)) || taken.set(normalize(form), e);
  for (const e of entries) for (const f of [e.name, ...real(e)]) take(f, e);
  // The same thing written another way ("St. Lawrence River" for the ranked Saint Lawrence, the table's link
  // "Javary River" for Javari) is one entry: the other spelling becomes an alias instead of a second, unranked entry.
  const owner = new Map<string, Entry>();
  const own = (e: Entry, forms: (string | undefined)[]) => {
    for (const f of forms) if (f && sameKey(f) && !owner.has(sameKey(f))) owner.set(sameKey(f), e);
  };
  for (const [i, e] of entries.entries()) own(e, [e.name, ...real(e), rows[i].redirectTarget, rows[i].link]);
  // The article a row's name cell links, or a category member's title: not an article guessed from a cell's text,
  // which can't tell "Rogue One" from "Rogue One: A Star Wars Story".
  const linked = new Map(entries.map((e, i) => [e, rows[i].link]));
  const linkedArticle = (x: Entry) => linked.get(x) ?? LINK.get(x) ?? (FROM_CATEGORY.has(x) ? ARTICLE.get(x) : undefined);
  const shortOf = (x: Entry) => new Set([...(SHORT.get(x) ?? [])].flatMap((s) => [normalize(s), sameKey(s)]));
  // Entries by their own name: a later row of that very name is that entry, whoever else has the name as a short form
  // (six "Star Wars" rows are the 1977 film, not six entries beside The Force Awakens).
  const named = new Map<string, Entry>();
  for (const e of entries) if (!named.has(normalize(e.name))) named.set(normalize(e.name), e);
  for (const e of extra) {
    const forms = ownForms(e).map(normalize).filter(Boolean);
    if (countryMembers.has(e)) forms.push(...countryNames(forms));
    const cut = (f: string, x: Entry) => shortFormOnly([normalize(f), sameKey(f)], shortOf(e), shortOf(x), linkedArticle(e), linkedArticle(x));
    const namesake = named.get(normalize(e.name));
    const known = namesake ? normalize(e.name) : forms.find((f) => taken.has(f) && !cut(f, taken.get(f)!));
    if (known) {
      // A team row by the member's own name first: the Orioles' cell also names their 1901 self, "Milwaukee Brewers".
      const into = (nicknamed.has(e) && entries.find((x) => normalize(x.name) === normalize(e.name))) || namesake || taken.get(known)!;
      // A team the table names in full ("Chicago Cubs") is typed by its nickname too: the universe's "Cubs", "Nats"
      // (judge, cycle 6: only the teams missing from the table had them).
      if (nicknamed.has(e)) {
        for (const a of e.aliases) {
          if (taken.has(normalize(a)) || junk.has(normalize(a))) continue;
          into.aliases.push(a);
          take(a, into);
        }
      }
      // The same answer in another dated table: the latest figure is the one to show (New York City keeps its
      // 2023 rank, not 2018's).
      adoptDated(into, e);
      inRegionWins(into, e);
      continue;
    }
    // Add-ons of an entry already listed ("Skyrim – Dragonborn" next to Skyrim) only blur what its name means.
    const base = e.name.split(" – ")[0];
    if (base !== e.name && taken.has(normalize(base))) continue;
    const same = [...ownForms(e), ARTICLE.get(e), LINK.get(e)]
      .map((f) => {
        const x = f ? owner.get(sameKey(f)) : undefined;
        return x && !cut(f!, x) ? x : undefined;
      })
      .find(Boolean);
    if (same) {
      if (!same.aliases.includes(e.name)) same.aliases.push(e.name);
      if (same.n === undefined && e.n !== undefined) Object.assign(same, { value: e.value, n: e.n });
      else adoptDated(same, e);
      inRegionWins(same, e);
      take(e.name, same);
      console.log(`     ${topic.id}: "${e.name}" is ${same.rank ? `#${same.rank} ` : ""}"${same.name}"`);
      continue;
    }
    entries.push(e);
    take(e.name, e);
    if (!named.has(normalize(e.name))) named.set(normalize(e.name), e);
    own(e, [e.name, ARTICLE.get(e), LINK.get(e)]);
  }
  for (const [name, shown] of zeroRows(topic)) {
    // The table's "Czech Republic: 0" is the universe's Czechia.
    const e = taken.get(name) ?? (countryMembers.size ? countryNames([name]).map((n) => taken.get(n)).find(Boolean) : undefined);
    if (e && e.rank === 0 && e.value === undefined) e.value = shown;
  }
  if (topic.people) {
    // A near miss with a figure ("Tyson Fury: #3 in 2025") is typed by surname like the ranked: "prescott" is Dak
    // Prescott, not a free "isn't an answer" (judge, cycle 5). Same rule as the ranked rows above.
    for (const e of entries.slice(rows.length)) if (e.value) addSurname(e);
  }

  if (junk.size) {
    for (const e of entries) {
      for (const a of e.aliases) if (junk.has(normalize(a))) logDrop(topic.id, e.rank, e.name, a, "listed in junkAliases");
      e.aliases = e.aliases.filter((a) => !junk.has(normalize(a)));
    }
  }
  const namesakes = new Map<string, Set<Entry>>();
  for (const [i, r] of rows.entries()) {
    if (r.plain) namesakes.set(normalize(r.plain), (namesakes.get(normalize(r.plain)) ?? new Set()).add(entries[i]));
  }
  const lower = new Map<Entry, string>();
  for (const [i, r] of rows.entries()) if (r.part?.lower) lower.set(entries[i], normalize(r.part.base));
  // An unranked part ("Bridgerton (Season 3)", cited) is lower than any ranked one: "bridgerton" stays Season 1's.
  for (const e of entries.slice(rows.length)) {
    const m = e.name.match(/^(.+?) \(([^()]+)\)$/);
    if (m && NUMBERED_PART.test(m[2])) lower.set(e, normalize(m[1]));
  }
  pruneAliases(entries, namesakes, lower);
  applyIntent(topic, entries);
  addSpellings(entries, topic.people);
  // Whatever the source (redirect, cell, universe), a slur never ships.
  for (const e of entries) e.aliases = e.aliases.filter((a) => !blockedAlias(a, [e.name]));
  // Nor text decoded in the wrong code page: "Eugčne Henri Paul Gauguin" (painters' judge). validate.ts fails a name
  // like that, which needs a `rename`.
  for (const { entry: e, form, why } of mangledForms(entries)) {
    if (form === e.name) continue;
    logDrop(topic.id, e.rank, e.name, form, `text in the wrong code page ("${why}")`);
    e.aliases = e.aliases.filter((a) => a !== form);
  }
  if (topic.values) {
    const [found, tried] = await addValues(topic, entries, articleOf, rows.map((r) => r.value));
    console.log(`     ${topic.id}: values for ${found} of ${tried} likely unranked answers`);
  }
  const dataAsOf = await dataDate(topic);
  if (topic.knownOnly || topic.knownNames) await writeKnown(topic, entries);
  // A place outside the region shows no figure and never scores: the list's stat is the region's.
  for (const e of entries) {
    if (!e.elsewhere) continue;
    delete e.value;
    delete e.n;
  }

  return {
    id: topic.id,
    title: topic.title,
    prompt: topic.prompt,
    noun: topic.noun,
    category: topic.category,
    ...(topic.region ? { region: topic.region } : {}),
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

/** A list's entry in public/puzzles/index.json (src/game/puzzles.ts `PuzzleMeta`). */
type IndexEntry = { id: string; title: string; category: string; blitz: boolean; debut?: true };

/** The index entry's `debut` flag, from topics.ts: present only on a new list that runs first as a daily. */
export const debutFlag = (topic?: Pick<Topic, "debut">): { debut?: true } => (topic?.debut ? { debut: true } : {});

/**
 * The index after building some lists: every list already indexed stays, the ones just built are updated or added,
 * all in topic order (lists topics.ts no longer has keep their place at the end). Every entry's `debut` follows
 * topics.ts, built now or not, so dropping the flag there takes effect on the next build of any list.
 */
export function mergeIndex(old: IndexEntry[], built: IndexEntry[], topics: Pick<Topic, "id" | "debut">[] = TOPICS): IndexEntry[] {
  const byId = new Map(old.map((e) => [e.id, e]));
  for (const e of built) byId.set(e.id, e);
  const order = new Map(topics.map((t, i) => [t.id, i]));
  const topic = new Map(topics.map((t) => [t.id, t]));
  const at = (e: IndexEntry) => order.get(e.id) ?? topics.length;
  return [...byId.values()].sort((a, b) => at(a) - at(b)).map((e) => {
    const { debut, ...rest } = e;
    return debut === debutFlag(topic.get(e.id)).debut ? e : { ...rest, ...debutFlag(topic.get(e.id)) };
  });
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
      index.push({ id: p.id, title: p.title, category: topic.category, blitz: !!p.blitz, ...debutFlag(topic) });
      console.log(`ok   ${p.id.padEnd(24)} ${p.answers.map((a) => a.name).join(", ")}`);
    } catch (err) {
      console.log(`FAIL ${topic.id.padEnd(24)} ${(err as Error).message}`, process.env.STACK ? (err as Error).stack : "");
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
