/**
 * Fathom's name-it round: "Name a country with about 50 million people". The player types a name; the game reads it
 * with TENtacle's own matcher (src/game/match.ts) over the round's list (public/fathom/lists/<id>.json: every country,
 * every city of the list, with their aliases), and the figure of the thing named (its population) scores against the
 * target. Only a name the list knows locks; anything else costs nothing and says why: a thing of another kind ("Paris
 * is a city, not a country."), a name we don't know, or a word several names share.
 *
 * Pure functions only: reading a list and a name-it question, reading a name, the best answers, the lines it says.
 */
import {
  FATHOM_KINDS,
  nameScore,
  readBank,
  type FathomKind,
  type FathomQuestion,
  type NameIt,
  type NameScoring,
} from "./fathom";
import { isKnownName, isPlainWord, isSlipOf, type Lexicon } from "./junk";
import { editDistance, judgeGuess, normalize } from "./match";
import type { Entry, Puzzle } from "./types";

/* ---------- Lists ---------- */

export interface NameEntry {
  name: string;
  aliases: string[];
  /** In the list's measure: 52886363 (people), 551695 (km²), 6 (land borders). */
  value: number;
}

/** A name-it round's list, as the data agent writes it (public/fathom/lists/<id>.json). Complete: every country. */
export interface NameList {
  id: string;
  /** "country" */
  noun: string;
  /** "countries" */
  nounPlural: string;
  /** What the values count, plural: "people", "km²", "land borders". */
  measure: string;
  scoring: NameScoring;
  source: { title: string; url: string };
  /** When the figures are from, as the list says it ("2024", "2026-11-07"). */
  asOf?: string;
  entries: NameEntry[];
}

/** A list id, as it names its file: kebab-case. */
export const LIST_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

/** One entry, if well formed: a name, its aliases (any that aren't text are left out) and a figure of 0 or more. */
function readEntry(x: unknown): NameEntry | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!isText(o.name) || typeof o.value !== "number" || !Number.isFinite(o.value) || o.value < 0) return null;
  const aliases = Array.isArray(o.aliases) ? o.aliases.filter(isText) : [];
  return { name: o.name, aliases, value: o.value };
}

/** A list file, if it is one (well-formed entries only; anything else left out). Null when it isn't. */
export function readList(json: unknown): NameList | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const src = o.source as Record<string, unknown> | undefined;
  if (!isText(o.id) || !LIST_ID.test(o.id) || !isText(o.noun) || !isText(o.nounPlural) || !isText(o.measure)) return null;
  if (o.scoring !== "ratio" && o.scoring !== "steps") return null;
  if (!src || !isText(src.title) || !isText(src.url) || !Array.isArray(o.entries)) return null;
  const entries = o.entries.map(readEntry).filter((e): e is NameEntry => !!e);
  if (!entries.length) return null;
  return {
    id: o.id,
    noun: o.noun,
    nounPlural: o.nounPlural,
    measure: o.measure,
    scoring: o.scoring,
    source: { title: src.title, url: src.url },
    ...(isText(o.asOf) && { asOf: o.asOf }),
    entries,
  };
}

/* ---------- Good answers ---------- */

/** A good answer scores Close or better: within about 1.45x of the target on a ratio list, one step on a steps list. */
export const GOOD_POINTS = 70;
/** A name-it question needs at least this many good answers, so a fair answer is never a lucky one. */
export const MIN_GOOD = 3;

const scoreOf = (list: Pick<NameList, "scoring">, e: NameEntry, target: number) => nameScore(list.scoring, e.value, target);
/** How far a figure is from the target on the list's own scale (powers of ten, or steps), for ordering. */
const distance = (list: Pick<NameList, "scoring">, value: number, target: number) =>
  list.scoring === "steps" ? Math.abs(value - target) : Math.abs(Math.log10(value / target)) || (value === target ? 0 : Infinity);

const excepted = (except: readonly string[] | undefined) => {
  const out = new Set((except ?? []).map(normalize));
  return (e: NameEntry) => out.has(normalize(e.name));
};

/** The entries that score GOOD_POINTS or more against the target, leaving out the question's `except`. */
export function goodAnswers(list: NameList, target: number, except?: readonly string[]): NameEntry[] {
  const out = excepted(except);
  return list.entries.filter((e) => !out(e) && scoreOf(list, e, target) >= GOOD_POINTS);
}

/**
 * The reveal's best answers: the `n` that score most against the target, the closest first, then in the list's own
 * order (the `except` left out): for 50 million people, Spain 48.6 million, South Korea 51.7 million...
 */
export function bestAnswers(list: NameList, target: number, except?: readonly string[], n = 4): NameEntry[] {
  const out = excepted(except);
  return list.entries
    .map((e, i) => ({ e, i, points: scoreOf(list, e, target), d: distance(list, e.value, target) }))
    .filter((x) => !out(x.e))
    .sort((a, b) => b.points - a.points || a.d - b.d || a.i - b.i)
    .slice(0, n)
    .map((x) => x.e);
}

/* ---------- Name-it questions ---------- */

/** The list ids a bank file's name-it questions use (the files the game fetches before it draws). */
export function nameListIds(json: unknown): string[] {
  const qs = (json as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs)) return [];
  const ids = qs
    .filter((q): q is Record<string, unknown> => !!q && typeof q === "object" && (q as Record<string, unknown>).round === "name")
    .map((q) => q.list)
    .filter((id): id is string => isText(id) && LIST_ID.test(id));
  return [...new Set(ids)];
}

/**
 * A name-it question from the bank file, played with its list: `{ id, round: "name", kind, list, target, question,
 * definition?, fact?, except?, easy? }`. Its unit is the list's measure, its answer the target and its source the
 * list's. Null when it isn't well formed, its list isn't there, or the target leaves fewer than MIN_GOOD good answers
 * (a list that changed under it): a round the game can't play fairly is left out, and the draw plays an estimate.
 */
export function readNameQuestion(raw: unknown, list: NameList | undefined): FathomQuestion | null {
  if (!raw || typeof raw !== "object" || !list) return null;
  const o = raw as Record<string, unknown>;
  if (o.round !== "name" || o.list !== list.id || !isText(o.id) || !isText(o.question)) return null;
  if (!(FATHOM_KINDS as readonly unknown[]).includes(o.kind)) return null;
  const target = o.target;
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0) return null;
  if (list.scoring === "ratio" ? target <= 0 : !Number.isInteger(target)) return null;
  const except = Array.isArray(o.except) ? o.except.filter(isText) : [];
  if (goodAnswers(list, target, except).length < MIN_GOOD) return null;
  const nameIt: NameIt = {
    list: list.id,
    scoring: list.scoring,
    noun: list.noun,
    nounPlural: list.nounPlural,
    ...(except.length && { except }),
    ...(list.asOf && { asOf: list.asOf }),
  };
  return {
    id: o.id,
    kind: o.kind as FathomKind,
    round: "name",
    question: o.question,
    unit: list.measure,
    answer: target,
    ...(isText(o.definition) && { definition: o.definition }),
    fact: isText(o.fact) ? o.fact : "",
    source: list.source,
    ...(o.easy === true && { easy: true }),
    nameIt,
  };
}

/**
 * Every question in a bank file the game can play: the number questions (readBank), and the name-it questions whose
 * lists are in `lists` (by id), each id once. Null when it isn't a bank.
 */
export function readFullBank(json: unknown, lists: ReadonlyMap<string, NameList>): FathomQuestion[] | null {
  const bank = readBank(json);
  if (!bank) return null;
  const seen = new Set(bank.map((q) => q.id));
  for (const raw of (json as { questions: unknown[] }).questions) {
    const list = raw && typeof raw === "object" ? lists.get(String((raw as Record<string, unknown>).list)) : undefined;
    const q = readNameQuestion(raw, list);
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    bank.push(q);
  }
  return bank;
}

/* ---------- Reading a name ---------- */

/**
 * What a typed name is, on a name-it round:
 * - `answer`: a thing on the list, named exactly ("Colombia", "UK", "Türkiye"): it locks.
 * - `confirm`: a misspelling, or part of a longer name, that points at one thing ("Frnace", "Mexico City" is not): it
 *   goes in the box for the player to lock in.
 * - `choose`: several things fit ("Irak": Iran or Iraq; "Congo"): the player taps one.
 * - `vague`: a word a crowd of names share: type more.
 * - `except`: the one the question names as its yardstick ("France" on "about as big as France").
 * - `other`: a thing of another kind ("Paris" on a country question: a city).
 * - `offList`: a thing of the same kind that isn't on this list.
 * - `unknown`: none of those.
 * Only `answer` locks; nothing else costs anything.
 */
export type NameRead =
  | { kind: "empty" }
  | { kind: "answer"; entry: NameEntry }
  | { kind: "confirm"; entry: NameEntry }
  | { kind: "choose"; names: string[] }
  | { kind: "vague" }
  | { kind: "except"; name: string }
  /**
   * `partOf`: a place that is part of something on a list ("Scotland": the UK; "Tasmania": Australia), said as that.
   * `plural`: a name that takes "are" ("The Canary Islands").
   */
  | { kind: "other"; name: string; noun: string; partOf?: string; plural?: boolean }
  | { kind: "offList"; name: string }
  | { kind: "unknown" };

/** A place a player may well type that no list has: what it is, and what it is part of, if it is part of one thing. */
export interface Place {
  /** What it is: "territory", "US state", "continent", "island", "region", "former country"; "country" for the UK's. */
  noun: string;
  /** What it is part of, as said in a line: "the UK", "Australia", "New York City". */
  partOf?: string;
  /** Its names take "are" ("The Azores are part of Portugal"). */
  plural?: boolean;
  names: readonly string[];
}

/** The noun of a country that no longer is one ("Yugoslavia is no longer a country."). */
export const FORMER = "former country";

/**
 * Places a player may well type that none of the lists has, by what they are: a territory, a US state, a continent, a
 * part of a country (the UK's nations, islands, regions, a city's boroughs), a region of several countries, a country
 * that no longer is one. Only to say what they are ("Greenland is a territory, not a country.", "Tasmania is part of
 * Australia, not a country."): never an answer, never corrected into one (Tasmania is not Tanzania), and a name the
 * round's own list has (Georgia, the country) is read as that first. Nothing disputed: a place whose status is argued
 * over (a breakaway region, a claimed territory) is left to the lists and the lexicon. The lists never carry one of these
 * as an alias (scripts/fathom/lists.ts drops them: "England" once locked the UK).
 */
export const PLACES: readonly Place[] = [
  {
    noun: "territory",
    names: [
      "Greenland", "Puerto Rico", "Hong Kong", "Macau", "Macao", "Guam", "Bermuda", "New Caledonia", "French Polynesia",
      "Tahiti", "Gibraltar", "Aruba", "Curaçao", "Isle of Man", "Jersey", "Guernsey", "American Samoa", "Réunion",
      "Martinique", "Guadeloupe", "French Guiana", "Mayotte", "Anguilla", "Montserrat", "Sint Maarten", "Bonaire", "Åland",
      "Svalbard", "Saint Helena",
    ],
  },
  {
    noun: "territory",
    plural: true,
    names: [
      "Faroe Islands", "Faroes", "Cayman Islands", "Falkland Islands", "Falklands", "US Virgin Islands", "British Virgin Islands",
      "Northern Mariana Islands", "Turks and Caicos Islands",
    ],
  },
  {
    noun: "US state",
    names: [
      "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida",
      "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
      "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
      "New Hampshire", "New Jersey", "New Mexico", "New York State", "North Carolina", "North Dakota", "Ohio", "Oklahoma",
      "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
      "Virginia", "Washington State", "West Virginia", "Wisconsin", "Wyoming",
    ],
  },
  { noun: "continent", names: ["Africa", "Europe", "Asia", "North America", "South America", "Antarctica", "Oceania"] },
  // The UK's nations are countries of their own within it: "Scotland is part of the UK."
  { noun: "country", partOf: "the UK", names: ["England", "Scotland", "Wales", "Northern Ireland", "N. Ireland"] },
  ...partsOf("island", {
    Australia: ["Tasmania"],
    Indonesia: ["Bali", "Java", "Sumatra", "Sulawesi", "Lombok"],
    France: ["Corsica"],
    Italy: ["Sardinia", "Sicily", "Capri"],
    Greece: ["Crete", "Rhodes", "Corfu", "Santorini", "Mykonos"],
    Spain: ["Mallorca", "Majorca", "Menorca", "Ibiza", "Tenerife", "Gran Canaria", "Lanzarote"],
    Portugal: ["Madeira"],
    Japan: ["Hokkaido", "Honshu", "Kyushu", "Shikoku", "Okinawa"],
    China: ["Hainan"],
    Tanzania: ["Zanzibar"],
    Thailand: ["Phuket", "Koh Samui"],
    Malaysia: ["Penang", "Langkawi"],
    Philippines: ["Luzon", "Mindanao", "Palawan", "Boracay"],
    Canada: ["Vancouver Island", "Newfoundland", "Prince Edward Island"],
    Ecuador: ["Galápagos", "Galapagos"],
    Chile: ["Easter Island"],
    Russia: ["Sakhalin"],
    "South Korea": ["Jeju"],
    Sweden: ["Gotland"],
    "the UK": ["Isle of Wight", "Isle of Skye", "Anglesey", "Shetland", "Orkney"],
    "the US": ["Long Island"],
  }),
  ...partsOf(
    "islands",
    { Spain: ["The Canary Islands", "Canaries", "The Balearic Islands", "Balearics"], Portugal: ["The Azores"], Ecuador: ["The Galápagos Islands"], "the UK": ["The Hebrides"] },
    true,
  ),
  ...partsOf("region", {
    Germany: ["Bavaria"],
    Italy: ["Tuscany", "Lombardy"],
    Canada: ["Quebec", "Québec", "Ontario", "British Columbia", "Alberta"],
    Belgium: ["Flanders", "Wallonia"],
    Russia: ["Siberia"],
    "the Czech Republic": ["Bohemia", "Moravia"],
    France: ["Normandy", "Brittany", "Provence", "Île-de-France"],
    Spain: ["Andalusia"],
    Romania: ["Transylvania"],
    Australia: ["Queensland", "New South Wales", "Western Australia"],
    India: ["Kerala", "Goa", "Maharashtra", "Rajasthan"],
    China: ["Guangdong"],
    Pakistan: ["Sindh"],
    Mexico: ["Yucatán", "Yucatan"],
  }),
  // A city's boroughs and districts, on a city question "part of New York City" (a city: no "not a city" after it).
  ...partsOf("district", {
    "New York City": ["Brooklyn", "Queens", "Manhattan", "The Bronx", "Staten Island"],
    "Hong Kong": ["Kowloon"],
    "Los Angeles": ["Hollywood"],
    London: ["Westminster"],
    Tokyo: ["Shibuya", "Shinjuku"],
  }),
  {
    noun: "region",
    names: [
      "Scandinavia", "The Middle East", "The Caribbean", "Central America", "Latin America", "Southeast Asia", "Central Asia",
      "Iberia", "Patagonia", "Lapland", "The Sahara", "Polynesia", "Benelux", "Mesopotamia", "The Arctic",
    ],
  },
  { noun: "region", plural: true, names: ["The Balkans"] },
  { noun: "island", names: ["Borneo", "Hispaniola"] },
  {
    noun: FORMER,
    names: [
      "Soviet Union", "USSR", "Yugoslavia", "Czechoslovakia", "East Germany", "West Germany", "Prussia", "Ottoman Empire",
      "Austria-Hungary", "Serbia and Montenegro", "Rhodesia",
    ],
  },
];

/** Places of one kind by what each is part of: `{ Australia: ["Tasmania"] }`. */
function partsOf(noun: string, by: Record<string, string[]>, plural = false): Place[] {
  return Object.entries(by).map(([partOf, names]) => ({ noun, partOf, names, ...(plural && { plural }) }));
}

/** Each place by its normalized names; a form two names share ("Quebec", "Québec") is the first's. */
const placeByForm = new Map<string, Place & { name: string }>();
for (const p of PLACES) for (const name of p.names) if (!placeByForm.has(normalize(name))) placeByForm.set(normalize(name), { ...p, name });

/** The place no list has that `text` names exactly, if it names one ("scotland": Scotland, part of the UK). */
export const placeNamed = (text: string): (Place & { name: string }) | undefined => placeByForm.get(normalize(text));

interface Read {
  puzzle: Puzzle;
  /** Each matcher entry's list entry. */
  of: Map<Entry, NameEntry>;
  /** Normalized names and aliases, and the entries that carry each. */
  forms: Map<string, NameEntry[]>;
}

const reads = new WeakMap<NameList, Read>();
let readsMade = 0;

/**
 * The list as the matcher reads a list: every entry one of the pool's accepted answers, ranked by its figure (the
 * biggest first: the natural reading of a shared name is the bigger place), so the matcher's typo, alias and
 * shared-name rules apply as they do in TENtacle. An id of its own for each list read, so the matcher's caches (by
 * puzzle id) never meet a TENtacle list's, or an older copy of this one.
 */
function readOf(list: NameList): Read {
  let r = reads.get(list);
  if (r) return r;
  readsMade += 1;
  const order = list.entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.value - a.e.value || a.i - b.i);
  const of = new Map<Entry, NameEntry>();
  const extras = order.map(({ e }, i) => {
    const entry: Entry = { rank: i + 1, name: e.name, aliases: e.aliases, value: String(e.value), n: e.value };
    of.set(entry, e);
    return entry;
  });
  const forms = new Map<string, NameEntry[]>();
  for (const e of list.entries) {
    for (const f of new Set([e.name, ...e.aliases].map(normalize))) {
      if (!f) continue;
      const at = forms.get(f) ?? [];
      if (!at.includes(e)) at.push(e);
      forms.set(f, at);
    }
  }
  const puzzle: Puzzle = {
    id: `fathom:${list.id}:${readsMade}`,
    title: list.nounPlural,
    prompt: "",
    noun: list.nounPlural,
    source: { name: list.source.title, url: list.source.url, asOf: list.asOf ?? "" },
    answers: [],
    extras,
  };
  r = { puzzle, of, forms };
  reads.set(list, r);
  return r;
}

type Judged = { kind: "exact" | "confirm"; entry: NameEntry } | { kind: "choose"; names: string[] } | { kind: "vague" } | { kind: "none" };

/** What the matcher makes of `text` on one list. An exact name or alias that only one entry carries is that entry. */
function judge(text: string, list: NameList, lex?: Lexicon, offered?: string[]): Judged {
  const r = readOf(list);
  const exact = r.forms.get(normalize(text));
  if (exact?.length === 1) return { kind: "exact", entry: exact[0] };
  const g = judgeGuess(text, r.puzzle, new Set(), lex, offered);
  if (g.kind === "near" || g.kind === "correct") {
    const entry = r.of.get(g.entry);
    if (entry) return { kind: g.corrected ? "confirm" : "exact", entry };
  }
  if (g.kind === "typo") return { kind: "choose", names: g.suggestions };
  if (g.kind === "unknown" && g.vague) return { kind: "vague" };
  return { kind: "none" };
}

const sameNoun = (a: NameList, b: NameList) => normalize(a.noun) === normalize(b.noun);

/** What was typed, as a name in a line: "berlin" as "Berlin". */
const titled = (text: string) => text.trim().replace(/\s+/g, " ").replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/**
 * Other ways of writing a name, read only as an exact name or alias: a list's inverted form ("Korea, North" is North
 * Korea, "Gambia, The" the Gambia) and the short forms of "Republic" and "Democratic" ("Dominican Rep.", "Dem. Rep.
 * Congo").
 */
export function rewrites(text: string): string[] {
  const out: string[] = [];
  const inverted = text.match(/^\s*([^,]+?)\s*,\s*([^,]+?)\s*$/);
  if (inverted) out.push(`${inverted[2]} ${inverted[1]}`);
  for (const t of [text, ...out]) {
    const long = t.replace(/\b(?:rep|repub)\b\.?/gi, "Republic").replace(/\bdem\b\.?/gi, "Democratic");
    if (long !== t) out.push(long);
  }
  return out;
}

/** The entry `text` names exactly on the list once rewritten (rewrites), if only one entry carries that form. */
function rewritten(text: string, list: NameList): NameEntry | undefined {
  const forms = readOf(list).forms;
  for (const t of rewrites(text)) {
    const at = forms.get(normalize(t));
    if (at?.length === 1) return at[0];
  }
  return undefined;
}

/**
 * Reads a typed name on a name-it round over its `list`. `others` are the other lists the game has (a city list on a
 * country question): what was typed is a thing of another kind when one of them knows it by that name and this list
 * doesn't ("Paris", "Lagos" rather than a misspelling of Laos, "Mexico City" rather than Mexico), and so is a place
 * none of them has (PLACES: Greenland, Texas, Scotland, Tasmania); a name of another kind, named exactly, is read as
 * that before anything on this list is read into it ("Tasmania" is not Tanzania, "Africa" on a city question not South
 * Africa). `lex`, the game's lexicon: a name of its own isn't read as a misspelling of something on the list, unless the
 * game stores it as a misspelling of that thing ("Irak", for Iraq: the confirm or the tap that a misspelling needs
 * keeps that fair); any other real name the list doesn't have says so ("Berlin isn't one of our 85 cities.", and
 * "Abkhazia" is not Afghanistan). `offered`: the names the last read offered, so typing or tapping one picks it.
 * `except`: names that don't count.
 */
export function readName(
  text: string,
  list: NameList,
  others: readonly NameList[] = [],
  { lex, offered, except }: { lex?: Lexicon; offered?: string[]; except?: readonly string[] } = {},
): NameRead {
  if (!normalize(text)) return { kind: "empty" };
  const out = excepted(except);
  const take = (e: NameEntry): NameRead => (out(e) ? { kind: "except", name: e.name } : { kind: "answer", entry: e });
  const main = judge(text, list, lex, offered);
  if (main.kind === "exact") return take(main.entry);
  const alt = rewritten(text, list);
  if (alt) return take(alt);

  // Not an exact name on this list: what the other lists make of it, and whether it's a place none of them has.
  const elsewhere = others
    .filter((o) => o.id !== list.id)
    .map((o) => ({ o, j: judge(text, o, lex) }))
    .filter((x): x is { o: NameList; j: Extract<Judged, { entry: NameEntry }> } => x.j.kind === "exact" || x.j.kind === "confirm");
  const exactElsewhere = elsewhere.find((x) => x.j.kind === "exact" && !sameNoun(x.o, list));
  // A thing of another kind, named exactly, is that thing, not a misspelling or part of something on this list.
  if (exactElsewhere) return { kind: "other", name: exactElsewhere.j.entry.name, noun: exactElsewhere.o.noun };
  const place = placeNamed(text);
  if (place) return { kind: "other", name: place.name, noun: place.noun, ...(place.partOf && { partOf: place.partOf }), ...(place.plural && { plural: true }) };

  const kept = (m: Judged): NameRead | undefined => {
    if (m.kind === "confirm") return out(m.entry) ? { kind: "except", name: m.entry.name } : { kind: "confirm", entry: m.entry };
    if (m.kind === "choose") {
      const names = m.names.filter((n) => !(except ?? []).some((x) => normalize(x) === normalize(n)));
      if (names.length === 1) {
        const entry = list.entries.find((e) => e.name === names[0]);
        if (entry) return { kind: "confirm", entry };
      }
      return names.length ? { kind: "choose", names } : { kind: "except", name: m.names[0] };
    }
    if (m.kind === "vague") return { kind: "vague" };
    return undefined;
  };
  const read = kept(main);
  if (read) return read;

  const kind = elsewhere.find((x) => !sameNoun(x.o, list));
  if (kind) return { kind: "other", name: kind.j.entry.name, noun: kind.o.noun };
  const same = elsewhere.find((x) => x.j.kind === "exact" && sameNoun(x.o, list));
  if (same) return { kind: "offList", name: same.j.entry.name };
  // The lexicon held back a reading because what was typed is a name somewhere. It is still offered when it is one slip
  // from what it was read as ("Chili", "Perm"), or a misspelling the game stores as one ("Irak", Iraq's): it needs a
  // confirm or a tap either way. A real name further off is itself, not a slip of something on the list ("Abkhazia" is
  // not Afghanistan); an ordinary word ("island", "kingdom") is no name at all.
  const plain = lex ? kept(judge(text, list, undefined, offered)) : undefined;
  if (plain && slipOf(text, plain, list, lex)) return plain;
  if (lex && isKnownName(text, lex)) return isPlainWord(text, lex) ? { kind: "unknown" } : { kind: "offList", name: titled(text) };
  return plain ?? { kind: "unknown" };
}

/**
 * Whether `text` is a slip of what `read` offers: one edit from one of its names (a letter off, a swap), or a misspelling
 * the game stores as one of it (`Lexicon.slips`: "Irak" of Iraq).
 */
function slipOf(text: string, read: NameRead, list: NameList, lex: Lexicon | undefined): boolean {
  const names = read.kind === "confirm" ? [read.entry.name] : read.kind === "choose" ? read.names : read.kind === "except" ? [read.name] : [];
  const t = normalize(text);
  return names.some((n) => {
    if (isSlipOf(text, n, lex)) return true;
    const e = list.entries.find((x) => x.name === n);
    return !!e && [e.name, ...e.aliases].some((f) => editDistance(t, normalize(f)) <= 1);
  });
}

/* ---------- What the round says ---------- */

/** "a city", "an island", "a US state", "a university". */
export function withArticle(noun: string): string {
  const an = /^[aeiou]/i.test(noun) && !/^(?:uni|use|eu|one|us\b|u\.s\.)/i.test(noun);
  return `${an ? "an" : "a"} ${noun}`;
}

/**
 * A name longer than this is left out of a line, so the line keeps to two lines on the narrowest phone (a line about a
 * list of countries holds a little less of one).
 */
const NAME_IN_LINE = 18;
const named = (name: string, fallback: string, max = NAME_IN_LINE) => (name.length <= max ? name : fallback);
const sameWord = (a: string, b: string) => normalize(a) === normalize(b);

/**
 * What the round says about a typed name that doesn't lock (nothing for `answer`; `choose` is followed by the names to
 * tap). Short and plain, two lines at most at 320px, "Try again." where nothing was lost and the player goes on.
 */
export function nameLine(read: NameRead, list: Pick<NameList, "noun" | "nounPlural" | "entries">): string {
  switch (read.kind) {
    case "empty":
      return `Type ${withArticle(list.noun)} first.`;
    case "confirm":
      return `${read.entry.name}? Lock in to confirm.`;
    case "choose":
      return "Did you mean";
    case "vague":
      return "More than one fits. Be more specific.";
    case "except":
      return `Any ${list.noun} but ${named(read.name, "that one")}. Try again.`;
    case "other": {
      const name = named(read.name, read.plural ? "They" : "That");
      const not = `not ${withArticle(list.noun)}`;
      if (read.noun === FORMER) return sameWord(list.noun, "country") ? `${name} is no longer a country. Try again.` : `${name} was a country, ${not}. Try again.`;
      // Part of something: "Scotland is part of the UK." (a country of its own, on a country question), "Tasmania is
      // part of Australia, not a country.", "Brooklyn is part of New York City, not a city."
      if (read.partOf) {
        if (sameWord(read.noun, list.noun)) return `${name} is part of ${read.partOf}. Try again.`;
        return `${name} ${read.plural ? "are" : "is"} part of ${read.partOf}, ${not}.`;
      }
      return `${name} ${read.plural ? "are" : "is"} ${withArticle(read.noun)}, ${not}. Try again.`;
    }
    case "offList":
      return `${named(read.name, "That", 14)} isn't one of our ${list.entries.length} ${list.nounPlural}. Try again.`;
    case "unknown":
      return "Not one we know. Try again.";
    default:
      return "";
  }
}

/** "2024", or a date the list was read ("2026-11-07") as its month: "November 2026". */
export function asOfText(asOf: string | undefined): string {
  if (!asOf) return "";
  const m = asOf.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return asOf;
  const month = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return `${month} ${m[1]}`;
}
