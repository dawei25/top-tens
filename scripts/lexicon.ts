// Trains the junk-guess model from an English word list plus every puzzle in public/puzzles.
// Usage: npx tsx scripts/lexicon.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fnv, trainLexicon } from "../src/game/junk";
import { editDistance, normalize } from "../src/game/match";
import { capitals, countries, usStates } from "./gazetteer";
import { COUNTRY_FORMS } from "./intent";
import { TOPICS } from "./topics";
import type { Puzzle } from "../src/game/types";

/**
 * States and provinces of the countries whose cities have lists, and a few more a player may type: known names, so
 * the game never corrects one into a different answer. Not answers anywhere.
 */
const SUBDIVISIONS = [
  // Canada
  "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan", "Nova Scotia", "New Brunswick",
  "Newfoundland and Labrador", "Prince Edward Island", "Yukon", "Northwest Territories", "Nunavut",
  // Brazil
  "Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal", "Espírito Santo", "Goiás",
  "Maranhão", "Mato Grosso", "Mato Grosso do Sul", "Minas Gerais", "Pará", "Paraíba", "Paraná", "Pernambuco", "Piauí",
  "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia", "Roraima", "Santa Catarina", "Sergipe", "Tocantins",
  // India
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal", "Jammu and Kashmir", "Ladakh",
  // China
  "Anhui", "Fujian", "Gansu", "Guangdong", "Guizhou", "Hainan", "Hebei", "Heilongjiang", "Henan", "Hubei", "Hunan",
  "Jiangsu", "Jiangxi", "Jilin", "Liaoning", "Qinghai", "Shaanxi", "Shandong", "Shanxi", "Sichuan", "Yunnan",
  "Zhejiang", "Guangxi", "Inner Mongolia", "Ningxia", "Xinjiang", "Tibet",
  // Australia
  "New South Wales", "Victoria", "Queensland", "Western Australia", "South Australia", "Tasmania",
  "Northern Territory",
  // United Kingdom
  "England", "Scotland", "Wales", "Northern Ireland",
  // Former countries and historic lands ("prussia" was corrected to Russia on a country list)
  "Prussia", "Yugoslavia", "Czechoslovakia", "Austria-Hungary", "Ottoman Empire", "Rhodesia", "Bohemia", "Bavaria",
  "Catalonia", "Kurdistan", "Siberia", "Scandinavia", "Mesopotamia",
];

const require = createRequire(import.meta.url);

/** JSON files in public/puzzles that are not puzzles: the index, this lexicon, the daily schedule, par scores. */
export const NOT_PUZZLES = new Set(["index.json", "lexicon.json", "daily.json", "par.json"]);

/**
 * Real names that are not answers, one file per list (`knownOnly` in topics.ts; build.ts writes them): every Netflix
 * original, though only seasons with a figure are answers. Known names, and counted like pool names for plain words.
 */
export const KNOWN_DIR = join(import.meta.dirname, "known");

/**
 * Every name and alias in the bank. `ranked` is the part from the source tables (ranked entries); the rest are
 * unranked pool members (universes, other tables, category members), thousands of them in some puzzles.
 */
export function bankNames(dir: string): Bank {
  const ranked: string[] = [];
  const all: string[] = [];
  /** Names of top-10 answers, and of every ranked person (lists with `people`). */
  const namesOfNote: string[] = [];
  const figured: string[] = [];
  const people: string[] = [];
  const slips: [string, string][] = [];
  // Passwords are keyboard mash on purpose: "qwerty" stays junk everywhere else.
  const notWords = new Set(TOPICS.filter((t) => t.notWords).map((t) => `${t.id}.json`));
  const peopleLists = new Set(TOPICS.filter((t) => t.people).map((t) => `${t.id}.json`));
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || NOT_PUZZLES.has(f) || notWords.has(f)) continue;
    const p: Puzzle = JSON.parse(readFileSync(join(dir, f), "utf8"));
    // Lists of people, and lists of names ("boys' names", "surnames"): every entry is someone's name.
    const ofPeople = peopleLists.has(f) || /\bnames$/i.test(p.noun ?? "");
    for (const e of [...p.answers, ...p.extras]) {
      const forms = [e.name, ...e.aliases];
      all.push(...forms);
      if (e.rank > 0) ranked.push(...forms);
      if ((e.rank > 0 && e.rank <= 10) || (e.rank > 0 && peopleLists.has(f))) namesOfNote.push(e.name);
      if (e.rank > 0 || e.value) figured.push(e.name);
      if (ofPeople) people.push(e.name);
      slips.push(...misspellings(e.name, e.aliases));
    }
    const known = join(KNOWN_DIR, f);
    if (existsSync(known)) all.push(...(JSON.parse(readFileSync(known, "utf8")) as string[]));
  }
  return { ranked, all, namesOfNote, figured, people, slips };
}

export interface Bank {
  ranked: string[];
  all: string[];
  namesOfNote: string[];
  /** Names of entries that show a figure when named: ranked ones, and unranked ones with a value. */
  figured: string[];
  /** Names on lists of people and lists of names. */
  people?: string[];
  /** Misspelling aliases with the name they misspell, normalized (`misspellings`). */
  slips?: [string, string][];
}

/**
 * An entry's aliases that misspell its own name, within two edits ("Afganistan" for Afghanistan, "Missisippi" for
 * Mississippi), with that name; normalized. Spacing variants ("Spider Man") aren't misspellings. Such an alias is a
 * known name (it's in the bank), yet typed on a list that lacks it, it is still that entry misspelled: the matcher
 * lets it correct to an entry of that name (`isSlipOf` in src/game/junk.ts) and to nothing else.
 */
export function misspellings(name: string, aliases: string[]): [string, string][] {
  const n = normalize(name);
  const out: [string, string][] = [];
  for (const a of aliases) {
    const s = normalize(a);
    if (!s || s === n || s.replace(/ /g, "") === n.replace(/ /g, "") || Math.abs(s.length - n.length) > 2) continue;
    if (editDistance(s, n) <= 2) out.push([s, n]);
  }
  return out;
}

/**
 * Words of people's names, four letters or more ("alcaraz", "jeremy", "johnston"): typed alone, someone's name. The
 * matcher corrects such a word only by one slip, onto an entry whose own name is that close, and on a list of names
 * not at all ("johnston" is not Johnson, "jeremy" not Jeffrey).
 */
export function personWords(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) for (const w of normalize(n).split(" ")) if (w.length >= 4 && !/\d/.test(w)) out.add(w);
  return [...out].sort();
}

/** Every usual form of a country with its name, normalized: "nippon" → "japan", "uk" → "united kingdom". */
export function countryForms(): [string, string][] {
  const out = new Map<string, string>();
  for (const [name, ...forms] of COUNTRY_FORMS) for (const f of forms) out.set(normalize(f), normalize(name));
  for (const c of countries()) for (const a of c.aliases) if (!out.has(normalize(a))) out.set(normalize(a), normalize(c.name));
  for (const [f, n] of [...out]) if (!f || f === n) out.delete(f);
  return [...out];
}

/**
 * Ordinary English words (3+ letters) that are a whole word of some name or alias in the bank but no name themselves:
 * "humans" (Destroy All Humans!), "water" (Avatar: The Way of Water), "trees" (Trees of Mystery). Typed alone they
 * mean the word, so the matcher doesn't read them as part of a longer name (src/game/junk.ts, `isPlainWord`). Words of
 * aliases count too: the matcher reads only names' words, but a word typed alone also never becomes a typo of one
 * ("water" is not Walter Masterson).
 *
 * Names keep their readings: `known`, the full names and aliases of ranked entries and places ("jordan", "china",
 * "avengers"), and every word of `namesOfNote`, the top-10 answers and ranked people. There a word alone is how
 * players name the answer: "cowboys" is the Dallas Cowboys, "pizza" Pizza Hut, "shark" Baby Shark, "swift" Taylor
 * Swift, "rose" Pete Rose. Without that, 240 such readings of top-10 answers were lost, and some became typos of
 * something else ("dragon" Doraemon).
 *
 * Unranked pool members are not in `known` (see `bankPlainWords`). Such an entry still matches when typed in full.
 */
export function plainWords(names: string[], known: Set<string>, namesOfNote: string[], dictionary: string[]): string[] {
  const english = new Set(dictionary.map((w) => normalize(w)).filter((w) => w.length >= 3 && !w.includes(" ")));
  const noted = new Set(namesOfNote.flatMap((n) => normalize(n).split(" ")));
  const out = new Set<string>();
  for (const n of names) {
    for (const w of normalize(n).split(" ")) {
      if (w.length >= 3 && english.has(w) && !known.has(w) && !noted.has(w)) out.add(w);
    }
  }
  return [...out].sort();
}

/**
 * The bank's plain words. Ranked names and aliases and places (`regions`) are names; unranked pool members mostly
 * aren't: thousands of them have articles, and an obscure one called "Humans" or "Music" is not what a player typing
 * the word means ("humans" no longer offers Destroy All Humans!).
 *
 * Words of top-10 answers and of names with a figure are plain here too: the matcher keeps them readable on the list
 * where such an entry is (`notableWords` in src/game/match.ts), so "swift" is Taylor Swift on Spotify artists and
 * "rainier" Mount Rainier on national parks, while "steel" on theme parks is not Steel Pier just because a film list
 * ranks Man of Steel (cycle 6: per list, not across the bank).
 */
export function bankPlainWords(bank: Bank, regions: string[], dictionary: string[]): string[] {
  const names = new Set([...bank.ranked, ...regions].map(normalize).filter(Boolean));
  return plainWords(bank.all, names, [], dictionary);
}

/** Writes public/puzzles/lexicon.json; says what it was trained on. */
export function writeLexicon(dir: string): string {
  const words: string[] = require("an-array-of-english-words");
  // Countries and capitals too, so "Fiji" or "Ljubljana" never reads as junk.
  const places = [...countries().flatMap((c) => [c.name, ...c.aliases]), ...capitals()];
  const bank = bankNames(dir);
  const { ranked, all } = bank;
  // The letter model learns from the ranked names only, so huge unranked pools (every YouTuber with an article)
  // don't skew what a plausible word looks like. Every name still counts as known.
  // Weight 2, not the default 5: the ranked bank is several times bigger than when the threshold was tuned.
  const lex = trainLexicon(words, [...ranked, ...places], 2);
  const known = new Set(lex.names.split(" "));
  // States and provinces are real names too: "amazonas" must not be corrected into the city Arapongas.
  const regions = [...places, ...SUBDIVISIONS, ...usStates().map((s) => s.name)];
  for (const n of [...all, ...regions]) {
    const s = normalize(n);
    if (s) known.add(fnv(s).toString(36));
  }
  lex.names = [...known].join(" ");
  const plain = bankPlainWords(bank, regions, words);
  const h = (s: string) => fnv(s).toString(36);
  const slips = [...new Set((bank.slips ?? []).map(([s, n]) => h(`${s}>${n}`)))];
  const people = personWords(bank.people ?? []);
  const forms = countryForms();
  // `words`, `slips`, `people` and `countries` are optional in the Lexicon format: older lexicons don't have them.
  const out = {
    ...lex,
    words: plain.map(h).join(" "),
    slips: slips.join(" "),
    people: people.map(h).join(" "),
    countries: forms.map(([f, n]) => `${h(f)}:${h(n)}`).join(" "),
  };
  writeFileSync(join(dir, "lexicon.json"), JSON.stringify(out));
  if (process.env.WORDS_LOG) writeFileSync(process.env.WORDS_LOG, plain.join("\n") + "\n");
  return `${all.length + places.length} names, ${plain.length} plain words, ${slips.length} misspellings, ${people.length} people's words`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(import.meta.dirname, "..", "public", "puzzles");
  console.log(`lexicon trained on ${writeLexicon(dir)}`);
}
