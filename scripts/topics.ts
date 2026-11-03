import { UNIVERSES, type Universe } from "./gazetteer";
import type { ValueKind } from "./values";

export interface Topic {
  /** When the table's numbers are from, if the page doesn't say in a way scripts/dates.ts can read. */
  dataAsOf?: string;
  id: string;
  category: "Geography" | "Entertainment" | "Sports" | "Business" | "Culture" | "Science" | "Oddball";
  /** Says what kind of thing the answers are: "Countries emitting the most CO2", not "Biggest CO2 emitters". */
  title: string;
  /**
   * What the player names, plural, lower case except proper nouns: "countries", "NBA players", "YouTube channels".
   * The game says it wherever a guess could be the wrong kind of thing.
   */
  noun: string;
  /** "Name the 10 ...", naming the noun. */
  prompt: string;
  page: string;
  /** Which wikitable(s) on the page, by index. Rows are concatenated. */
  tables: number[];
  /** Header text (case-insensitive substring) or column index for the answer name. */
  name: string | number;
  /** Header text or column index for the ranked value. */
  value: string | number;
  /**
   * Another column that breaks ties in `value` (higher first), for a source that gives a range: fiction authors rank
   * by their low sales estimate and the high one decides between equals. The shown value is the range
   * ("400–600 million"); `value` alone is what Blitz scores.
   */
  tiebreak?: string | number;
  metric: string;
  /** Appended to the displayed value, e.g. " km²". */
  unit?: string;
  /**
   * Header text or column index saying which part of the named thing a row is ("Season 2"): the rows are parts,
   * named "Squid Game (Season 2)". The thing's own name and article go to its highest-ranked part only, so
   * "squid game" is the season that ranks highest; the others are typed with their number ("squid game 2"). A part
   * that isn't numbered ("Limited Series") is named like the thing. `rename` takes "Monster (Season 1)" too.
   */
  part?: string | number;
  /** Take names from cell text instead of the first link's text. */
  nameFromText?: boolean;
  /** Take names from the first link's article title ("Nokia 1100" for a cell showing "1100"). */
  nameFromLink?: boolean;
  /** Removed from names, e.g. the ", NY-NJ MSA" suffix of a metro area. */
  nameStrip?: RegExp;
  /** Prepended to the displayed value, e.g. "#". */
  prefix?: string;
  /**
   * Words to strip for an extra short-form alias, e.g. /\b(desert)\b/gi turns "Gobi Desert" into "Gobi". Several
   * patterns give one short form each ("M72 Tour" and "M72" from "M72 World Tour").
   */
  stripWords?: RegExp | RegExp[];
  /** Keep the table's order instead of sorting by value (descending). */
  keepOrder?: boolean;
  /** Skip rows whose first column is not a number (unranked rows like "World"). */
  rankedOnly?: boolean;
  /**
   * Rows the ranking leaves out (no rank with `rankedOnly`, or no figure in the ranked column) are not answers, so
   * guessing one is free: Monaco has no IMF figure, Hong Kong no rank among Asian countries.
   */
  unrankedRowsFree?: boolean;
  /**
   * Not answers at all, so guessing one is free: table rows, rows of `also` tables and universe members with these
   * names ("World"; DC and the territories on the state lists).
   */
  skip?: string[];
  /** Extra alias sources: other columns whose text/link text also names the row. */
  aliasCols?: (string | number)[];
  /** Add surnames as aliases (when unique within the list). */
  people?: boolean;
  /** Also accept every member of these sets as a real (life-costing) answer, even ones missing from the table. */
  universe?: Universe | Universe[];
  /**
   * The universe only names the rows (country forms, demonyms, the country junk list): members the tables leave out
   * are free, not answers. A country McDonald's never opened in costs nothing.
   */
  universeNamesOnly?: boolean;
  /** Name rows after the universe member they match ("Boston / Milwaukee / Atlanta Braves" → "Atlanta Braves"). */
  canonical?: boolean;
  /** Only keep rows whose `col` cell matches. */
  where?: { col: string | number; match: RegExp };
  /** More accepted answers, unranked: names from other tables on this page or another page. */
  also?: Also[];
  /**
   * Wikipedia categories (without "Category:") whose article titles all become unranked accepted answers,
   * e.g. every YouTube channel with an article. Subcategories are followed `categoryDepth` levels (default 0: the category itself).
   */
  universeCategories?: string[];
  categoryDepth?: number;
  /** Display names for category members, by article title ("Dalmatian dog" is shown as "Dalmatian"); the title stays an alias. */
  categoryRename?: Record<string, string>;
  /** Extra aliases by entry name, for well-known short forms Wikipedia has no redirect for. */
  aliases?: Record<string, string[]>;
  /**
   * Give the likeliest unranked answers (scripts/likely.ts) a value read from their article's infobox, so a miss
   * can say "Matterhorn: 4,478 m". Only where the infobox number means the same as the list's metric.
   * `scale` turns the infobox number into the table's unit (1e6 for a table in millions). A value must be below
   * #10's (`below: "last"`: below the last ranked row's, for tables that rank everyone above a cutoff); one that
   * isn't measures something else and is dropped.
   */
  values?: { kind: ValueKind; scale?: number; below?: "tenth" | "last" };
  /**
   * Why a miss outside a short ranking (25 rows or fewer) shows no figure: no other table or infobox has one
   * ("every other country has none"). Without it, scripts/validate.ts fails such a list when none of its unranked
   * answers has a value (give them one with `also` and `dated`, or `values`).
   */
  noFigures?: string;
  /** #1 has the smallest number (a rank such as Similarweb's). Such a list is never Blitz: a bigger n isn't better. */
  lowerIsBetter?: boolean;
  /**
   * Another column that says the same in another unit: a `value` cell that disagrees with it × `factor` by more
   * than 2% is replaced by the converted number (shown rounded). The US states' km² column has misread cells
   * ("382.936" for Nevada); their square miles × 2.589988 are right.
   */
  fallback?: { from: string | number; factor: number };
  /** Creative works (books, shows, films, albums, games): redirects sharing no word with the title are songs or characters. */
  works?: boolean;
  /** The table writes every word capitalized ("Shape Of You"): small words go lower case ("Shape of You"). */
  titleCase?: boolean;
  /** Web addresses are names here ("x.com", "Amazon.com"); elsewhere a redirect like "Dallascowboys.com" is dropped. */
  webNames?: boolean;
  /**
   * The name cell joins several things with dashes, and only the first is the answer: a river system
   * ("Saint Lawrence–Niagara–Detroit–...") is not also Detroit. No aliases from the other parts.
   */
  noParts?: boolean;
  /** Display names for rows, by the name the table gives ("Padma" is shown as "Ganges"). */
  rename?: Record<string, string>;
  /**
   * A row's figure when the table's is stale or unreadable, by the name the table gives, with where it comes from:
   * Dhaka's 2022 census where the table still has 2011's. `value` is read like a table cell ("10,278,882").
   */
  overrides?: Record<string, { value: string; source: string }>;
  /** Aliases to drop by exact text (after normalize): junk the rules in scripts/aliases.ts can't tell from a name. */
  junkAliases?: string[];
  /** The Wikipedia article for an entry, by name, when the table links the wrong one (or none). */
  articles?: Record<string, string>;
  /** Unranked accepted answers no source lists, with their aliases (a famous name that only misses the cut). */
  more?: Record<string, string[]>;
  /**
   * Unranked accepted answers whose figure only an article's text gives, with where it says so: Netflix's ranking
   * stops at 10, but Bridgerton's article gives Season 3's 106 million views. `value` is shown as written; `n` is the
   * same number in the ranked rows' unit, below #10's.
   */
  cited?: Record<string, { value: string; n: number; aliases: string[]; source: string }>;
  /**
   * Names of the list's kind that are not answers, read like `also`: free to guess (no figure to learn from), but
   * still real names to the game. The build records them in scripts/known/<id>.json and the lexicon learns them, so
   * typed in full one is never junk nor corrected into an answer, and their words still count as plain words.
   */
  knownOnly?: Also[];
  /**
   * More known names no table lists, as `knownOnly` (free, real names): the usual spellings of crossbreeds the
   * crossbreed page leaves out ("Aussiedoodle", "Yorkipoo").
   */
  knownNames?: string[];
  /** Category members to leave out of the pool (titles that aren't the kind of thing the list is about). */
  categorySkip?: RegExp;
  /**
   * Keep only category members that look like names: no sentence-case concept titles ("Search engine bias") and
   * no plain dictionary words ("Display", "Universe").
   */
  categoryNames?: boolean;
  /**
   * No redirect aliases: the rows link name articles ("Smith (surname)", "Mary (name)"), whose redirects are other
   * names ("Smithson", "Blacksmith", "Mae"), not ways of typing this one.
   */
  noRedirects?: boolean;
  /** Names can be numbers ("123456" on passwords): no row is dropped for its digits. */
  numberNames?: boolean;
  /**
   * The names are keyboard mash on purpose (passwords: "qwerty", "1qaz2wsx"): they stay out of the lexicon, so such
   * input still reads as junk on every other list.
   */
  notWords?: boolean;
}

/** A source of unranked accepted answers: one name column of some tables on a page (default: the topic's). */
export interface Also {
  page?: string;
  tables: number[];
  name: string | number;
  nameFromText?: boolean;
  nameFromLink?: boolean;
  skip?: string[];
  /** Other columns that also name the row (the artist of a tour), as on a topic. */
  aliasCols?: (string | number)[];
  /** Only keep rows whose `col` cell matches, as on a topic. */
  where?: { col: string | number; match: RegExp };
  /** Names for these tables' rows, by the name the table gives: "Mercedes" is the pool's "Mercedes-Benz". */
  rename?: Record<string, string>;
  /**
   * A column with the list's own stat, in the ranked rows' unit: each answer from these tables shows it and scores
   * it in Blitz, unranked. Titanic is in the inflation table's nominal column ($200 million) but not in the ranking,
   * which stops above $200 million. A number at or above the last ranked row's means something else and is dropped.
   */
  value?: string | number;
  /**
   * These tables rank the same thing for another year or by another source (the 2024 top 10 on a 2025 list, a 2016
   * survey): an unranked answer shows its latest rank and figure from them, labelled so it can't pass for the
   * list's own: "#6 in 2024 (16.5 million)", a rank alone "#3 in 2019", a figure alone "2.98 million (2016)". It
   * stays unranked and never scores in Blitz (no `n`); the figure isn't capped at #10's, since another year's can
   * be higher. An answer with the list's own stat (a `value` source without `dated`) keeps that instead.
   */
  dated?: Dated;
}

export interface Dated {
  /** Column with the row's rank in that table. */
  rank?: string | number;
  /**
   * When the ranking is from. Default: the year in the value, rank or name column's header ("Arrivals 2024"), else
   * in the table's caption or heading ("1987–1989"). "{year}" in it stands for that year ("Q4 {year}").
   */
  label?: string;
  /** Who ranked it, when that isn't the list's own source: "#43 in 2016 (Mastercard, 2.98 million)". */
  source?: string;
  /** Divides the cell's number into the shown unit: 1e6 with `unit` " million" shows 16,500,000 as "16.5 million". */
  scale?: number;
  /** Shown before the figure ("$"); default: the cell's own currency sign. */
  prefix?: string;
  /** Shown after the figure (default: the topic's unit). */
  unit?: string;
  /**
   * The figure every row shows, for a table that only lists who passed a mark: "$100 million+" on the athletes who
   * earned that much in some year ("Joe Burrow: $100 million+ (2024)").
   */
  figure?: string;
  /** The name cell ends with the figure ("Tencent 688,000"): the number is the figure, the rest the name. */
  figureInName?: boolean;
  /**
   * A table with one row per year (each year's top tour, the record as it grew): `col` holds the row's year (the
   * latest, if it lists several), which fills "{year}" in the label row by row, and `rank` is the rank every row
   * held that year: "#1 in 2025
   * ($407,600,113)" for the year's highest-grossing tour.
   */
  perYear?: { col: string | number; rank?: number };
}

/** Redirects to US states that are jokes, documents, agencies or teams, found by the list judges. */
const STATE_JUNK = [
  "America's Wang", "Florida map", "Myflorida.com", "Phoenix Scorpions", "Tucson Javelinas", "Arizona State Government",
  "Arizona State Board of Education", "Colorado military facilities", "Colorado protected areas", "Nevada Annulment",
  "Montana Folk Festival", "Wyoming State Constitution", "Alaska borough", "Idaho Constitution", "Idaho State Constitution",
  "Idaho State Tax Commission", "Idaho government", "Rockford Academy", "Illinois demographics",
  "Eastern vs Western North Carolina barbecue", "Michigan.org", "California–Guangdong relations", "Flowery Easter",
  "Texas-sized",
  // Postal codes that are everyday words, among the redirects ("oh" was Ohio).
  "IN", "OR", "ME", "HI", "OK", "OH",
];

/** People among the earlier years' richest who have died: naming one is free. */
const DECEASED_BILLIONAIRES = [
  "Taikichiro Mori", "Sam Walton", "Salim Ahmed Bin Mahfouz", "Hans Rausing", "Paul Reichmann", "Shin Kyuk-ho",
  "Kenneth Thomson", "Erivan Haub", "Minoru Mori", "Samuel Newhouse", "Paul Sacher", "Tsai Wan-lin", "Karl Albrecht",
  "Chung Ju-yung", "Paul Allen", "Forrest Mars Sr.", "Jay Pritzker", "John Walton", "Helen Walton", "Ingvar Kamprad",
  "Sheldon Adelson", "Theo Albrecht", "David Koch", "Liliane Bettencourt",
];

/** Families among the earlier years' top 10s: the list ranks people, so naming a family is free. */
const BILLIONAIRE_FAMILIES = [
  "Walton family", "Mars family", "Du Pont family", "Haas family", "Kwok brothers", "Oeri, Hoffman & Sacher families",
  "Haniel family",
];

/** DC and the territories: not states, so naming one on a state list is free (and they take no rank). */
const NOT_STATES = ["District of Columbia", "Puerto Rico", "Guam", "U.S. Virgin Islands", "American Samoa", "Northern Mariana Islands"];

/**
 * Rows of the market cap tables that are no company of their own: the country column, and other names of ranked
 * companies ("Petro China" is PetroChina, "Royal Dutch Shell" is Shell).
 */
const MARKET_CAP_SKIP = [
  ...UNIVERSES.countries().map((c) => c.name),
  "United States", "United Kingdom", "South Korea", "Netherlands United Kingdom", "Petro China", "Royal Dutch Shell",
  "Samsung",
];

/** Big city tables, so any sincere city guess on a city list is an accepted answer. */
const CITIES: Also[] = [
  { page: "List of largest cities", tables: [0], name: "City" },
  { page: "List of United States cities by population", tables: [1], name: "Municipality" },
  { page: "List of national capitals by population", tables: [0], name: "Capital" },
  { page: "List of European cities by population within city limits", tables: [0], name: "City" },
  { page: "List of cities in India by population", tables: [0], name: "Name", skip: ["India"] },
  { page: "List of cities in China by population", tables: [2, 3], name: "City" },
  { page: "List of cities in Brazil by population", tables: [1], name: "Municipality" },
  { page: "List of the 100 largest municipalities in Canada by population", tables: [0], name: "Municipality" },
  { page: "List of cities by international visitors", tables: [0, 1, 2, 3], name: "City" },
];

/** Famous accounts on the big social platforms, shared by the follower-count lists. */
const CELEBRITIES: Also[] = [
  { page: "List of most-followed X accounts", tables: [0, 1], name: "Owner" },
  { page: "List of most-followed TikTok accounts", tables: [0, 1], name: "Owner" },
  { page: "List of most-followed Instagram accounts", tables: [1], name: "Owner" },
  { page: "List of most-followed Facebook pages", tables: [0], name: "Page name" },
  { page: "List of most-subscribed YouTube channels", tables: [0], name: "Name" },
];

/**
 * The test set: 10 lists that between them exercise every feature, for fast iteration
 * (`npm run build:puzzles -- --test`). Run a full build before launch.
 */
export const TEST_SET = [
  "countries-population", // every-country pool, country aliases
  "islands", // UK -> Great Britain, New Zealand group, Faroe Islands
  "mountains", // Matterhorn, article values
  "nba-points", // first names
  "video-games", // numbers in titles, big category pool
  "youtube-channels", // Smosh, category pool
  "films-gross", // titles
  "airports", // codes and cities
  "us-states-population", // every-state pool
  "spotify-artists", // long metric label, data date
];

/** The AKC tables' links and cells, by the breed's article name ("French Bulldogs" is the French Bulldog). */
const DOG_NAMES: Record<string, string> = {
  "French Bulldogs": "French Bulldog",
  Poodles: "Poodle",
  Bulldogs: "Bulldog",
  "English Bulldog": "Bulldog",
  Beagles: "Beagle",
  Rottweilers: "Rottweiler",
  "Laborador Retriever": "Labrador Retriever",
};

export const TOPICS: Topic[] = [
  // Geography
  {
    id: "countries-population",
    category: "Geography",
    title: "Most populous countries",
    noun: "countries",
    prompt: "Name the 10 most populous countries in the world",
    page: "List of countries and dependencies by population",
    tables: [0],
    name: "Location",
    value: "Population",
    metric: "Population",
    skip: ["World"],
    universe: "countries",
  },
  {
    id: "countries-area",
    category: "Geography",
    title: "Largest countries by area",
    noun: "countries",
    prompt: "Name the 10 largest countries by total area",
    page: "List of countries and dependencies by area",
    tables: [0],
    name: "Country",
    value: "Total",
    metric: "Total area",
    unit: " km²",
    rankedOnly: true,
    universe: "countries",
  },
  {
    id: "countries-gdp",
    category: "Geography",
    title: "Countries with the largest economies",
    noun: "countries",
    prompt: "Name the 10 countries with the largest GDP (nominal, IMF)",
    page: "List of countries by GDP (nominal)",
    tables: [0],
    name: "Country",
    value: "IMF",
    metric: "GDP (US$ millions)",
    skip: ["World"],
    universe: "countries",
  },
  {
    id: "africa-population",
    category: "Geography",
    title: "Most populous African countries",
    noun: "countries",
    prompt: "Name the 10 most populous countries in Africa",
    page: "List of African countries by population",
    tables: [0],
    name: "Country",
    value: "Population",
    metric: "Population",
    rankedOnly: true,
    universe: "countries",
    // "Congo" is the Republic of the Congo here; the bare name offers both Congos (build.ts).
    rename: { Congo: "Republic of the Congo" },
  },
  {
    id: "asia-population",
    category: "Geography",
    title: "Most populous Asian countries",
    noun: "countries",
    prompt: "Name the 10 most populous countries in Asia",
    page: "List of Asian countries by population",
    tables: [0],
    name: "Country",
    value: "Totalpopulation",
    metric: "Population",
    rankedOnly: true,
    universe: "countries",
    // UN 2023 estimates; Hong Kong and Macau have no rank in the table, so naming them is free.
    dataAsOf: "2023",
    unrankedRowsFree: true,
  },
  {
    id: "europe-population",
    category: "Geography",
    title: "Most populous European countries",
    noun: "countries",
    prompt: "Name the 10 most populous countries in Europe (transcontinental countries included)",
    page: "List of European countries by population",
    tables: [0],
    name: "Location",
    value: "UN estimate",
    metric: "Population (UN 2025)",
    skip: ["Europe"],
    universe: "countries",
  },
  {
    id: "us-states-population",
    category: "Geography",
    title: "Most populous US states",
    noun: "US states",
    prompt: "Name the 10 most populous US states",
    page: "List of U.S. states and territories by population",
    tables: [0],
    name: "State",
    value: "2025",
    metric: "Population (2025 est.)",
    rankedOnly: true,
    skip: NOT_STATES,
    universe: "us-states",
    junkAliases: STATE_JUNK,
  },
  {
    id: "us-states-area",
    category: "Geography",
    title: "Largest US states",
    noun: "US states",
    prompt: "Name the 10 largest US states by total area",
    page: "List of U.S. states and territories by area",
    tables: [0],
    name: "State",
    value: "Total area / km",
    // The km² column has misread cells (Nevada "382.936", Idaho 275,213 for 216,443): square miles are clean.
    fallback: { from: "Total area / mi", factor: 2.589988 },
    metric: "Total area",
    unit: " km²",
    skip: ["United States", "50 States and DC", "50 States", "Contiguous US", "Minor Outlying Islands", ...NOT_STATES],
    universe: "us-states",
    junkAliases: STATE_JUNK,
  },
  {
    id: "us-cities",
    category: "Geography",
    title: "Most populous US cities",
    noun: "cities",
    prompt: "Name the 10 most populous cities in the United States (city proper)",
    page: "List of United States cities by population",
    tables: [1],
    name: "Municipality",
    value: "2025",
    metric: "Population (2025 est.)",
    junkAliases: [
      "Monroe May Elementary", "Monroe may", "San diego beaches", "Fort Worth United Soccer Club", "Sister Cities Chicago",
      "Land of smelly onions", "Houstonians", "New York Shitty",
    ],
  },
  {
    id: "world-cities",
    category: "Geography",
    title: "Largest cities in the world",
    noun: "cities",
    prompt: "Name the 10 largest cities in the world (UN 2025 estimates)",
    page: "List of largest cities",
    tables: [0],
    name: "City",
    value: "UN 2025",
    metric: "Population (UN 2025)",
    also: CITIES,
    universe: "capitals",
    junkAliases: [
      "Western Grammar School", "Agradut Bidyanikaton High School", "Guangzhou No.7 High school", "Momin High School",
      "Dainik Vishwamitra", "Sangwon Middle School", "Five Grand Palaces of Joseon-Dynasty Seoul", "Five Grand Palaces",
      "6-resurrection", "Tokyo in pop culture", "Jūjō, Tokyo", "Qinglong, Shanghai", "West Bund", "Abdeen", "Fatehpur beri",
      "Fuxingmen Inner Street", "Fuxingmen Outer Street", "Fuxing Road", "St. Xavier's High School Loyola Hall",
      "Prakash Higher Secondary School", "Prakash school", "Phss", "SJK Lai Meng", "Sichuanese teahouse",
      "Mexican Federal District Transit System", "Sister Cities Chicago",
      // Parks, temples, a stadium, bridges and a people among the redirects.
      "Jai Prakash Narayan National Park", "Jayaprakash Narayan National Park", "JP Narain park", "JP Park",
      "Ambika Niketan Temple", "Chintamani Jain Temple", "Khsetrapal Temple", "Kantareshwar Mahadev Temple",
      "Ambaji- Balaji Temple", "Rang Upvan Stadium", "Althan National Park", "Bharthana National Park", "Lake Cliff Park",
      "Four bridges on three lines", "Four bridges on three support", "Shenzhen Software Park", "Shanghai people",
    ],
  },
  {
    id: "mountains",
    category: "Geography",
    title: "Highest mountains",
    noun: "mountains",
    prompt: "Name the 10 highest mountains on Earth",
    page: "List of highest mountains on Earth",
    tables: [0],
    name: "Mountain",
    value: "Height",
    metric: "Height",
    unit: " m",
    values: { kind: "elevation" },
    universeCategories: ["Eight-thousanders", "Eight-thousanders of the Himalayas", "Seven Summits", "Alpine four-thousanders", "Great north faces of the Alps", "Mountains of the Alps", "Stratovolcanoes of Japan"],
    // Climbing lore the categories carry along: peak lists, challenges, huts, routes, expeditions.
    categorySkip: /\b(summits|eight-thousanders?|death zone|grand slam|expedition|hut|huts|route|refuge|cable car|railway|glacier|tunnel|ski)\b/i,
    junkAliases: ["Kazi Sherpa", "Kanchenjunga 2", "Mount Hymalaya", "Diamer face", "Rupal face"],
    // Famous peaks the tables and categories miss; values come from their articles (likely.ts).
    more: {
      "Mount Rainier": ["Rainier", "Mt Rainier"], "Mount Whitney": ["Whitney"], "Mount Kenya": [], "Ben Nevis": [],
      "Mount Olympus": ["Olympus"], "Aoraki / Mount Cook": ["Aoraki", "Mount Cook", "Mt Cook"], "Mount Shasta": ["Shasta"],
      "Mount Hood": ["Hood"], "Mount Etna": ["Etna"], "Mount Vesuvius": ["Vesuvius"], "Mount Ararat": ["Ararat"],
      "Mount Logan": [], "Table Mountain": [], "Snowdon": ["Yr Wyddfa"], "Teide": ["Mount Teide", "Pico del Teide"],
      "Mount St. Helens": ["St. Helens", "Mount Saint Helens"], "Pikes Peak": [], "Mount Washington": [],
      "Mount Sinai": [], "Mount Kinabalu": ["Kinabalu"], "Mount Damavand": ["Damavand"], "Mount Kazbek": ["Kazbek"],
      "Mount Erebus": ["Erebus"],
    },
  },
  {
    id: "rivers",
    category: "Geography",
    title: "Longest rivers",
    noun: "rivers",
    prompt: "Name the 10 longest rivers in the world",
    page: "List of rivers by length",
    tables: [1],
    name: "River",
    value: "Length (km)",
    metric: "Length",
    unit: " km",
    keepOrder: true,
    // Cells name whole systems ("Saint Lawrence–Niagara–Detroit–..."): the other rivers are not this one.
    noParts: true,
    // The table names the Ganges system by its lowest stretch; players know it as the Ganges.
    rename: { Padma: "Ganges" },
    values: { kind: "length" },
    universeCategories: ["International rivers of Asia", "International rivers of Europe", "International rivers of Africa", "International rivers of South America", "International rivers of North America", "Sacred rivers", "Rivers of London"],
    // Famous rivers under 1,000 km that the table and the categories leave out; their length comes from the article.
    more: {
      Seine: ["River Seine"],
      "Hudson River": ["Hudson"],
      "Potomac River": ["Potomac"],
      Tiber: ["River Tiber"],
      "Po River": ["Po"],
      "River Shannon": ["Shannon"],
      "River Severn": ["Severn"],
      Arno: ["River Arno"],
      Ebro: ["Ebro River"],
      "River Liffey": ["Liffey"],
      "River Clyde": ["Clyde"],
      "Charles River": [],
      "Delaware River": [],
      "Sacramento River": [],
      "Chao Phraya River": ["Chao Phraya"],
      "Snake River": [],
    },
    junkAliases: ["Piaro"],
  },
  {
    id: "islands",
    category: "Geography",
    title: "Largest islands",
    noun: "islands",
    prompt: "Name the 10 largest islands in the world",
    page: "List of islands by area",
    tables: [1],
    name: "Island",
    value: "Area",
    metric: "Area",
    unit: " km²",
    values: { kind: "area" },
    universe: "countries",
    also: [{ page: "List of archipelagos", tables: [0], name: 0 }],
    universeCategories: ["Archipelagoes of the Pacific Ocean", "Archipelagoes of the Atlantic Ocean", "Archipelagoes of the Indian Ocean"],
    // Continents and island countries are not islands: a guess at Australia or Japan is free (the UK means Great
    // Britain, see intent.ts).
    skip: ["Australia", "Antarctica", "Japan", "Indonesia", "Philippines"],
    junkAliases: [
      "Borneo flags", "New Guinea Man", "Sumatera Celebes", "ID-SM", "Eastern Sumatra", "Kangat Bay", "Lupanglunti",
      "Lupanlunti", "Nunavut", "China",
    ],
  },
  {
    id: "lakes",
    category: "Geography",
    title: "Largest lakes",
    noun: "lakes",
    prompt: "Name the 10 largest lakes in the world by area",
    page: "List of lakes by area",
    tables: [1],
    name: "Name",
    value: "Area",
    metric: "Area",
    unit: " km²",
    // "Lake Superior", not "Superior" (a word, and Michigan is a state); the table's short names stay aliases.
    nameFromLink: true,
    // Famous lakes past the table (likely.ts) show their infobox surface area.
    values: { kind: "area" },
    also: [{ tables: [3], name: "Name", skip: ["Michigan–Huron", "Lake Michigan–Huron"] }],
    // Famous lakes the tables and categories miss; their area comes from the article (likely.ts).
    more: {
      "Great Salt Lake": [], "Lake Como": [], "Lake Garda": [], "Lake Balaton": [], "Lake Okeechobee": [], "Lake Mead": [],
      "Lake Powell": [], "Crater Lake": [], "Lake Bled": [],
    },
    categoryNames: true,
    // Bays, a wind, a river and an agency among the redirects to the top 10.
    junkAliases: [
      "Misery Bay", "Lakehead Region Conservation Authority", "Hammond Bay", "Lake Huron, Ontario", "Lake Illinois",
      "Good Harbor Bay", "Sleeping Bear Bay", "Platte Bay", "Caspian Sea bordering countries", "Sarma", "Sarma wind",
      "The Galapagos of Russia", "Dease River", "Lake Niassa and its Coastal Zone", "Boadzulu island", "Caspian area",
    ],
    // The Great Lakes categories hold the region's history, ships and festivals rather than lakes.
    categorySkip: /\b(dispute|crisis|festival|storm|commission|company|lines|program|agreement|compact|charter|conference|clan|people|basin|region|states|surfing|tour|datum|patrol|group|suite|laboratory|alliance|refugee|carp|expedition|shipwrecks?|flood|monster|fishery)\b/i,
    universeCategories: ["Rift lakes", "Ancient lakes", "Lakes of Russia", "International lakes of Europe", "International lakes of Asia", "International lakes of Africa", "International lakes of North America", "International lakes of South America", "Saline lakes of Asia", "Endorheic lakes of Asia", "Freshwater lochs of Scotland", "Lakes of Switzerland", "Lakes of Italy", "Glacial lakes"],
  },
  {
    id: "tourism",
    category: "Geography",
    title: "Most visited countries",
    noun: "countries",
    prompt: "Name the 10 countries with the most international tourist arrivals in 2024",
    page: "World Tourism rankings",
    tables: [0],
    name: "Destination",
    value: "2024",
    metric: "Arrivals (millions, 2024)",
    // Regional top 10s give near misses a 2024 figure (Thailand 35.5). They are no world ranking past #10, so no
    // ranks; a figure above #10's (China 64.9, Hong Kong 45.0, missing from the world table) is left out.
    also: [{ tables: [1, 2, 3, 4], name: "Destination", value: "2024" }],
    universe: "countries",
  },
  {
    id: "billionaire-countries",
    category: "Business",
    title: "Countries with the most billionaires",
    noun: "countries",
    // Hong Kong (#8) is a territory: the source column is "Country/Territory".
    prompt: "Name the 10 countries or territories with the most billionaires (Forbes 2026)",
    page: "List of countries by number of billionaires",
    tables: [0],
    name: "Country",
    value: "2026",
    metric: "Billionaires",
    skip: ["World"],
    universe: "countries",
  },

  // Entertainment
  {
    id: "films-gross",
    category: "Entertainment",
    title: "Highest-grossing films",
    noun: "films",
    prompt: "Name the 10 highest-grossing films of all time (worldwide, not adjusted)",
    page: "List of highest-grossing films",
    tables: [0],
    name: "Title",
    value: "Worldwide gross",
    metric: "Worldwide box office (US$)",
    works: true,
    also: [
      { tables: [1, 2, 3], name: "Title" },
      { page: "List of highest-grossing animated films", tables: [0, 1, 2, 3], name: "Title" },
      { page: "List of highest-grossing films in the United States and Canada", tables: [0, 1], name: "Title" },
      { page: "List of most expensive films", tables: [0, 2], name: "Title" },
    ],
    // Other films' names (Spider-Man 3 is a 2007 film, not No Way Home) and home-video editions.
    junkAliases: [
      "Spider-Man 3", "Avatar IV", "Zootopia Three", "Top Gun 3", "Untitled third Top Gun film", "Star Wars 10",
      "Inside Out 3", "The Lion King 4", "Frozen IIII", "Jikŋon 2", "Frozen fandom", "Frozen Reo Māori", "Titanic DVD releases",
      "Titanic DVD Release", "Titanic DVD", "Titanic VHS", "Titanic 5 Disc", "Titanic Blu-ray", "Titanic 3D",
      "The Super Mario Bros. Movie 3", "Pratt Mario",
    ],
    skip: ["Harry Potter and the Sorcerer's Stone"],
  },
  {
    id: "youtube-channels",
    category: "Entertainment",
    title: "Most-subscribed YouTube channels",
    noun: "YouTube channels",
    prompt: "Name the 10 most-subscribed YouTube channels",
    page: "List of most-subscribed YouTube channels",
    tables: [0],
    name: "Name",
    value: "Subscribers",
    metric: "Subscribers (millions)",
    values: { kind: "subscribers", scale: 1e6 },
    also: [{ tables: [1, 2], name: 0 }],
    universeCategories: ["YouTube channels", "YouTubers"],
    categoryDepth: 2,
    junkAliases: ["Hindi", "Nursery Rhymes", "Track 5"],
    // A table footnote ("As of October 2026 UTC").
    skip: ["UTC"],
  },
  {
    id: "youtube-videos",
    category: "Entertainment",
    title: "Most-viewed YouTube videos",
    noun: "YouTube videos",
    prompt: "Name the 10 most-viewed YouTube videos",
    page: "List of most-viewed YouTube videos",
    tables: [0],
    name: "Video name",
    value: "Views",
    metric: "Views (billions)",
    works: true,
    also: [
      { tables: [1], name: "Video name" },
      { page: "List of most-liked YouTube videos", tables: [0, 1], name: "Video name" },
    ],
    universeCategories: ["Viral videos", "YouTube videos"],
    // Category members that are a person, a channel, a web series, a device, a film or a trend, not a video.
    skip: [
      "Ronaldinho", "I/O Brush", "Myspace – The Movie", "Viral video", "Donald Trump",
      "Donald Trump (Last Week Tonight with John Oliver)", "Geoffrey Baron", "Tom Brier",
      "Stuart Chaifetz", "Vic DiBitetto", "Irene Esser", "Robert Greenwald", "Connor Michalek", "Germano Mosconi",
      "Hansell Riojas", "Janina San Miguel", "Israa Seblani", "Martin Ssempa", "Chuck Testa", "Pita Taufatofua",
      "Piotr Szczerek", "Ricardo Milos", "Deltalina", "Grindmother", "Moymoy Palaboy", "Kratu", "Joueur du Grenier",
      "Mrwhosetheboss", "Good Mythical Morning", "Nostalgia Critic", "Red Letter Media", "Red vs. Blue", "Annoying Orange",
      "The Juice Media", "Primitive Technology", "Mo Mountain Mutts", "Skibidi Toilet", "The Show with No Name",
      "Rickrolling", "Bottle flipping", "Mannequin Challenge", "Silhouette Challenge", "Golden retriever egg challenge",
      "Soda geyser", "Battle of Buulo Mareer", "Norfolk Southern–Gregson Street Overpass", "St. Patrick's Day beating",
      "Montgomery Riverfront brawl", "Mitt Romney's 47 percent comments",
    ],
    // Killings and other incidents filmed and shared: events, not videos a player names.
    categorySkip: /^(killing|killing and dismemberment|murder|torture|firing) of\b|\bincident$/i,
    // Cocomelon's own upload of the song; "Baby Shark" means Pinkfong's #1 (intent.ts).
    rename: { "Baby Shark": "Baby Shark (Cocomelon)" },
  },
  {
    id: "instagram",
    category: "Entertainment",
    title: "Most-followed Instagram accounts",
    noun: "Instagram accounts",
    prompt: "Name the 10 most-followed Instagram accounts",
    page: "List of most-followed Instagram accounts",
    tables: [1],
    name: "Owner",
    value: "Followers",
    metric: "Followers (millions)",
    aliasCols: ["Username"],
    people: true,
    also: CELEBRITIES,
    // Instagram's own features, users and studies (Stories, Live, "Instagrammer") and the stars' relatives and songs
    // are in CELEBRITY_JUNK (scripts/aliases.ts), shared with the Facebook list, which has an Instagram page too.
  },
  {
    id: "video-games",
    category: "Entertainment",
    title: "Best-selling video games",
    noun: "video games",
    prompt: "Name the 10 best-selling video games of all time",
    page: "List of best-selling video games",
    tables: [0],
    name: "Title",
    value: "Sales",
    metric: "Copies sold (millions)",
    works: true,
    universeCategories: ["The Game Awards winners", "Golden Joystick Award for Game of the Year winners", "Spike Video Game Awards Game of the Year winners", "Video games adapted into films", "Open-world video games", "Namco arcade games", "Arcade video games"],
    // People, teams, studios and a show among the award categories.
    skip: [
      "Ludwig Ahgren", "Laura Bailey", "Greg Miller", "Amir Satvat", "Carol Shaw", "Boogie2988", "Bugha", "Chovy", "SonicFox",
      "Cloud9", "G2 Esports", "Ninjas in Pyjamas", "CD Projekt Red", "Arcane",
    ],
    junkAliases: [
      "Deluxe", "Human", "Plus", "Blue", "Yellow", "Silver", "Crystal", "Shield", "Pearl", "Platinum", "Violet",
      "Pokémon Red, Blue, Yellow", "Tetris music", "Controversies surrounding Grand Theft Auto V",
      "Controversies surrounding GTA V", "Controversies surrounding Minecraft", "Minecraft chat report",
      "Minecraft chat reporting", "Minecraft and LGBT", "Minecraft and LGBTQ", "Minecraft and LGBTQIA+",
      "Minecraft's cultural impact",
    ],
  },
  {
    id: "consoles",
    category: "Entertainment",
    title: "Best-selling game consoles",
    noun: "game consoles",
    prompt: "Name the 10 best-selling video game consoles (home and handheld)",
    page: "List of best-selling game consoles",
    tables: [0],
    name: "Platform",
    value: "Units sold",
    metric: "Consoles sold",
    universeCategories: ["Home video game consoles", "Handheld game consoles"],
    categorySkip: /\bgenerations?\b/i,
    // Models of a ranked console are that console (intent.ts); Brazil-only Tectoy rows get their own names, so "Mega
    // Drive" and "Master System" mean Sega's.
    skip: ["Game Boy Color", "New Nintendo 3DS", "Game Boy Advance SP", "Xbox Series X and Series S"],
    rename: { "Mega Drive": "Mega Drive (Tectoy)", "Master System": "Master System (Tectoy)" },
    junkAliases: [
      "Touching is good", "Tag mode", "Memory Pak", "Download Play", "DS Option Pak", "Yellow Light of Death", "YLOD",
      "ApocalyPS3", "Ring-con", "PlayGo", "Shareplay", "Pulse 3D", "SoundScope", "Dot matrix with stereo sound", "PartnerNet",
      "Nintendo DS launch titles", "Nintendo DS launch", "Nintendo DS Download Play",
    ],
  },
  {
    id: "books",
    category: "Culture",
    title: "Best-selling books",
    noun: "books",
    prompt: "Name the 10 best-selling single books of all time (no religious or political texts, no multi-volume works)",
    page: "List of best-selling books",
    tables: [0, 1, 2, 3],
    name: "Book",
    value: "sales",
    metric: "Copies sold (approx.)",
    // A half-translated Japanese title with a stray parenthesis.
    also: [{ tables: [9, 10, 11, 12], name: "Book", skip: ["六星占術によるあなたの運命 Tells Your Fortune)"] }],
    works: true,
    junkAliases: [
      "The Da Vinci Code paintings", "Lord of the Rings Prequel", "Vengeance", "Roger Cly", "Mrs. Cruncher",
      "Théophile Gabelle", "Emily Brent", "Vera Claythorne", "Sophie Neveu", "Bezu Fache", "Leigh Teabing", "Cryptex",
      "Arkenstone", "Asteroid B", "B 612", "Tale of Two Cities, A",
    ],
  },
  {
    id: "fiction-authors",
    category: "Culture",
    title: "Best-selling fiction authors",
    noun: "authors",
    prompt: "Name the 10 best-selling fiction authors of all time (low estimate of copies sold)",
    page: "List of best-selling fiction authors",
    tables: [0],
    name: "Author",
    // The high estimates tie at #10/#11 (500 million), and so do the low ones (400 million): ranked by the low
    // estimate, the high one breaks ties (Enid Blyton, 400-600 million, is #10; Jackie Collins, 400-500, #11).
    value: "Min. estimated sales",
    tiebreak: "Max. estimated sales",
    metric: "Estimated copies sold (low–high)",
    people: true,
    // Authors with only a high estimate (Lewis Carroll, David Baldacci, Patricia Cornwell) are answers without a
    // rank: a miss shows that figure.
    also: [{ tables: [0], name: "Author", value: "Max. estimated sales", dated: { label: "high estimate only" } }],
    // Books, relatives, companies and studies among the redirects (pen names stay: Mary Westmacott, Robert Galbraith).
    junkAliases: [
      "William Shakespeare biography", "Shakespearean theatre", "Shakespearean scholar", "Shakespearian studies",
      "Shakespeare studies", "Shakespeareana", "Tropes in Agatha Christie's novels", "Plot devices in Agatha Christie's novels",
      "Agatha Christie Ltd.", "Christie Estate", "Frederick Alvah Miller", "Clarissa Miller", "Margaret Watts",
      "Louis Montant Miller", "Frederick Boehmer", "Nathaniel Frary Miller", "Jorge Arantes", "Neil Murray",
      "Mackenzie Jean Rowling Murray", "Mackenzie Murray", "Mackenzie Rowling", "Jessica Rowling Arantes",
      "Harry Potter encyclopaedia", "Harry Potter encyclopedia", "J k rowling books", "The Elephant House",
      "Volant Charitable Trust", "Very Good Lives", "Accidental Heroes", "Dirty Snow", "Trixie Koontz", "Relentless",
      "Buried Alive", "Voice of Thunder", "Little lost hen", "The Little lose hen", "The Three Golliwogs",
    ],
  },
  {
    id: "languages",
    category: "Culture",
    title: "Most spoken languages",
    noun: "languages",
    prompt: "Name the 10 most spoken languages (first + second language speakers)",
    page: "List of languages by total number of speakers",
    tables: [0],
    name: "Language",
    value: "Total",
    metric: "Speakers (millions)",
    nameFromText: true,
    also: [{ page: "List of languages by number of native speakers", tables: [0, 1], name: "Language", nameFromText: true }],
    universeCategories: ["Languages of India", "Languages of Europe"],
    // Overview articles and peoples in the categories, and pool entries that hijack a ranked language's name.
    categorySkip: /^(languages|classical languages|multilingualism|indian states)\b|\b(people|peoples|dialects|macaronic language)$/i,
    skip: ["Hijra Farsi", "Punjabi dialects", "German-Russian macaronic language"],
    junkAliases: ["Frenches"],
  },
  {
    id: "buildings",
    category: "Culture",
    title: "Tallest buildings",
    noun: "buildings",
    prompt: "Name the 10 tallest completed buildings in the world",
    page: "List of tallest buildings",
    tables: [1],
    name: "Name",
    value: "Height / m",
    metric: "Height",
    unit: " m",
    also: [
      { tables: [3, 5, 6, 7], name: "Building" },
      { page: "List of tallest buildings in New York City", tables: [0], name: "Name" },
    ],
    universeCategories: ["Skyscrapers"],
    // The table links CITIC Tower to its article, China Zun; the plain title is a 33-storey Hong Kong office block.
    articles: { "CITIC Tower": "China Zun" },
    // The plane that hit China Zun in 2026; the park; a name cut short.
    junkAliases: ["B-12PP", "Central Park", "Trump International Hotel and", "Signiel"],
    // Famous, completed, and missing from the tables (it would otherwise be corrected to Burj Almasa).
    more: { "Burj Al Arab": ["Burj al-Arab"] },
  },

  // Sports
  {
    id: "olympic-medals",
    category: "Sports",
    title: "Countries with the most Olympic medals",
    noun: "countries",
    prompt: "Name the 10 countries with the most Olympic medals of all time (Summer + Winter)",
    page: "All-time Olympic Games medal table",
    tables: [0, 2],
    name: 0,
    value: 15,
    metric: "Total medals",
    universe: "countries",
    junkAliases: [
      "Swedish sin", "Folkland", "Britain's languages", "Great Britain's languages", "Council Union", "Soviet order",
      "People's republic of russia", "United states of soviet russia", "European USSR", "De", "Modern day China",
    ],
  },
  {
    id: "nba-points",
    category: "Sports",
    title: "NBA career scoring leaders",
    noun: "NBA players",
    prompt: "Name the 10 NBA players with the most career points (regular season)",
    page: "List of National Basketball Association career scoring leaders",
    tables: [1],
    name: "Player",
    value: "Total points",
    metric: "Points",
    values: { kind: "nba-points", below: "last" },
    people: true,
    also: [
      { page: "List of National Basketball Association career assists leaders", tables: [1], name: "Player" },
      { page: "List of National Basketball Association career rebounding leaders", tables: [1], name: "Player" },
    ],
    universeCategories: ["NBA All-Stars"],
    junkAliases: [
      "Gloria James", "Bronny's dad", "LeBron's son", "Bronny James Sr.", "Natalia Diamante Bryant", "Natalia Diamante",
      "Kobe bryant philanthropy", "Mamba Sports Academy", "Deloris Jordan", "Juanita Vanoy", "James R. Jordan, Jr.",
      "Silke Nowitzki", "Helga Nowitzki", "Helga Bredenbröcker", "Joe Toney", "Joseph Toney", "The Big Podcast with Shaq",
      "Shaqtoberfest", "Shaq's Size", "My Next Chapter", "You the real MVP", "Triple-double cocaine bear",
    ],
  },
  {
    id: "stadiums",
    category: "Sports",
    title: "Largest stadiums",
    noun: "stadiums",
    prompt: "Name the 10 largest stadiums in the world by capacity (any sport, college stadiums included)",
    page: "List of stadiums by capacity",
    tables: [0, 1, 2, 3, 4, 5, 6],
    name: "Stadium",
    value: "Capacity",
    metric: "Capacity",
    // Camp Nou keeps the page's pre-renovation 99,354 (#12). Its article (October 2026) gives 62,652 while stands
    // reopen in phases and 105,000 only as expected for 2028-29 (that would be #5): no override until it's built.
    // Events, TV shows and scoreboards named after the stadiums.
    junkAliases: [
      "Buckeye Country Superfest", "12th Man TV", "Walk of Champions", "Godzillatron", "Adzillatron", "Salt", "Australia",
      "Lincoln", "The Shoe",
    ],
  },

  // Business
  {
    id: "companies-revenue",
    category: "Business",
    title: "Largest companies by revenue",
    noun: "companies",
    prompt: "Name the 10 largest companies in the world by revenue",
    page: "List of largest companies by revenue",
    tables: [0],
    name: "Name",
    value: "Revenue",
    metric: "Revenue (US$ billions)",
    also: [
      // The country column of these tables is no company; "Petro China", "Royal Dutch Shell" and "Samsung" are
      // ranked entries by other names (intent.ts).
      { page: "List of public corporations by market capitalization", tables: [0], name: "Company", skip: MARKET_CAP_SKIP },
      { page: "List of public corporations by market capitalization", tables: range(1, 27), name: 2, skip: MARKET_CAP_SKIP },
      { page: "List of public corporations by market capitalization", tables: range(1, 27), name: 4, skip: MARKET_CAP_SKIP },
    ],
    // Junk among the redirects: COMPANY_JUNK in scripts/aliases.ts, shared by every company list.
    webNames: true,
  },
  {
    id: "airports",
    category: "Business",
    title: "Busiest airports",
    noun: "airports",
    prompt: "Name the 10 busiest airports in the world by passenger traffic (2025)",
    page: "List of busiest airports by passenger traffic",
    tables: [0],
    name: "Airport",
    value: "Totalpassengers",
    metric: "Passengers (2025)",
    values: { kind: "passengers" },
    aliasCols: ["Code"],
    also: [{ tables: [1, 2, 3, 4, 5], name: "Airport" }],
    // Earlier years' tables use old names; without these they come back as unranked duplicates of ranked rows.
    aliases: {
      "Harry Reid International Airport": ["McCarran International Airport", "McCarran"],
      "Adolfo Suárez Madrid–Barajas Airport": ["Madrid Barajas Airport", "Madrid Barajas", "Madrid"],
      "Leonardo da Vinci Rome Fiumicino Airport": ["Rome Fiumicino", "Rome"],
    },
    // Tokyo's other airport, so "Tokyo" can offer both.
    more: { "Narita International Airport": ["Narita", "Tokyo Narita"] },
    junkAliases: [
      "United Airlines Flight 1015", "Atlas Air Flight 6972", "Frontier Airlines Flight 4345", "Shibby",
      "Denver international airport murals", "Atlanta Motordrome", "Heathrow arrival stacks", "London Heathrow Crashes",
      "Bovingdon stack", "Heathrow.com", "Dubai Air wing Hangar", "Dubai Royal Airwing Hangar", "Dubai International Terminal 1",
      "O'Hare Modernization Program", "Dfwairport.com", "Garhoud",
    ],
    // Earlier years' names of ranked or listed airports (intent.ts gives them to the airport).
    skip: ["London Gatwick Airport", 'Rome–Fiumicino International Airport "Leonardo da Vinci'],
  },

  // Batch 2: sports
  {
    id: "super-bowl-wins",
    category: "Sports",
    title: "NFL teams with the most Super Bowl wins",
    noun: "NFL teams",
    prompt: "Name the 10 NFL teams with the most Super Bowl wins",
    page: "List of Super Bowl champions",
    tables: [4],
    name: "Franchise",
    value: "Wins",
    metric: "Super Bowl wins",
    noFigures: "every other team has no Super Bowl win",
    universe: "nfl-teams",
    canonical: true,
    junkAliases: [
      "Pittsburgh Steelers stadiums", "Pittsburgh Pirates", "Dallascowboys.com", "Dallas cowboy players",
      "Dallas Cowboys retired numbers", "Dallas Cowboys Super Bowls", "Kansas City Chiefs Cheerleaders",
      "Kansas City Chiefs Hall of Fame", "Packers Pro Shop", "Packers fan", "New York Giants Depth Chart", "Redskinettes",
      "70 Greatest Redskins", "Command Force", "New England Patriots strategy", "Denver Broncos Ring of Fame",
      "Broncos Ring of Fame", "Denver Broncos retired numbers", "San Francisco 49ers Hall of Fame", "49ers Hall of Fame",
      "Let's Ride", "Just win, baby", "Stillers",
    ],
  },
  {
    id: "world-series-wins",
    category: "Sports",
    title: "MLB teams with the most World Series titles",
    noun: "MLB teams",
    prompt: "Name the 10 MLB teams with the most World Series titles",
    page: "List of World Series champions",
    tables: [1],
    name: "Team",
    value: "Wins",
    metric: "World Series titles",
    universe: "mlb-teams",
    canonical: true,
    junkAliases: [
      "Yankees Suck", "New York Yankees Roster", "Yankees Roster", "Dodgers Roster", "Reds Roster",
      "St. Louis Cardinals roster", "Detroit Tigers roster", "Pittsburgh Pirates roster", "Kruk and Kuip", "Talksox",
      "Piratefest", "Atlanta Braves 1990s pitching rotation", "Philadelphia / Kansas City / Oakland / Athletics",
      // Cities with another team too: "new york" was the Giants, "philadelphia" the Athletics.
      "Philadelphia", "Kansas City", "New York", "Milwaukee",
    ],
  },
  {
    id: "f1-wins-by-country",
    category: "Sports",
    title: "Countries with the most F1 race wins",
    noun: "countries",
    prompt: "Name the 10 countries whose drivers have won the most Formula One Grands Prix",
    page: "List of Formula One Grand Prix winners",
    tables: [3],
    name: "Country",
    value: "Wins",
    metric: "Grand Prix wins",
    noFigures: "every other country has no Grand Prix win",
    universe: "countries",
    junkAliases: ["Swedish sin"],
  },
  {
    id: "premier-league-goals",
    category: "Sports",
    title: "Premier League all-time top scorers",
    noun: "players",
    prompt: "Name the 10 players with the most Premier League goals",
    page: "List of Premier League players with 100 or more goals",
    tables: [0],
    name: "Player",
    value: "Goals",
    metric: "Premier League goals",
    people: true,
    also: [
      { page: "List of footballers with 500 or more goals", tables: [0, 1], name: "Player" },
      { page: "Ballon d'Or", tables: [2], name: "Player" },
    ],
    universeCategories: ["First Division/Premier League top scorers", "Premier League Hall of Fame inductees", "English Football Hall of Fame inductees", "Premier League players"],
    junkAliases: ["Elen Rivas", "Nicole Merry", "Tommy Rooney", "Sergioaguero.com"],
  },
  {
    id: "nfl-passing-yards",
    category: "Sports",
    title: "NFL career passing yards leaders",
    noun: "quarterbacks",
    prompt: "Name the 10 NFL quarterbacks with the most career passing yards (regular season)",
    page: "List of NFL career passing yards leaders",
    tables: [1],
    name: "Player",
    value: "Yds",
    metric: "Passing yards",
    people: true,
    universeCategories: ["Pro Football Hall of Fame inductees"],
    junkAliases: [
      "Brittany Dudchenko", "Brittany Brees", "MVP of Super Bowl XLIV", "Ashley Manning", "Laser rocket arm", "Irvin Favre",
      "Favregate", "Aaron Rodgers Day", "Aaron Rodgers and COVID-19", "Throw Rogan", "Kelly Stafford", "Stephen Rivers",
      "Gunner Rivers", "199 Productions", "Autograph", "Dan Marino Football", "Dan Marino's Touchdown Football",
    ],
  },
  {
    id: "nfl-rushing-yards",
    category: "Sports",
    title: "NFL career rushing yards leaders",
    noun: "NFL players",
    prompt: "Name the 10 NFL players with the most career rushing yards (regular season)",
    page: "List of NFL career rushing yards leaders",
    tables: [1],
    name: "Player",
    value: "Yards",
    metric: "Rushing yards",
    people: true,
    also: [{ page: "List of NFL career passing yards leaders", tables: [1], name: "Player" }],
    universeCategories: ["Pro Football Hall of Fame inductees"],
    junkAliases: ["Emmitt III Smith", "Jerome Bettis Day"],
  },
  {
    id: "mlb-home-runs",
    category: "Sports",
    title: "MLB career home run leaders",
    noun: "MLB players",
    prompt: "Name the 10 MLB players with the most career home runs",
    page: "List of Major League Baseball career home run leaders",
    tables: [1, 2, 3, 4],
    name: "Player",
    value: 2,
    metric: "Home runs",
    people: true,
    // Not the Hall of Fame: it adds managers, umpires and executives with no home runs, each a costly miss.
  },
  {
    id: "nhl-goals",
    category: "Sports",
    title: "NHL career goal leaders",
    noun: "NHL players",
    prompt: "Name the 10 NHL players with the most career goals (regular season)",
    page: "List of NHL players with 500 goals",
    tables: [0],
    name: 2,
    value: "Goals",
    metric: "Goals",
    people: true,
    also: [
      { page: "List of NHL players with 1,000 points", tables: [0], name: 2 },
      { page: "List of NHL players with 1,000 points", tables: [1, 2], name: "Player" },
    ],
    universeCategories: ["Hockey Hall of Fame inductees"],
    junkAliases: [
      "Trevor Gretzky", "Gretzky's Office", "The Trade", "Gretzky trade", "Missus Hockey", "The Howe Family", "Troy Crosby",
      "Cindy Crosby",
    ],
    // The page says "as of the 2025–26 season"; the table's own caption gives no date.
    dataAsOf: "2025–26 season",
  },

  // Batch 2: entertainment
  {
    id: "x-accounts",
    category: "Entertainment",
    title: "Most-followed X accounts",
    noun: "X accounts",
    prompt: "Name the 10 most-followed accounts on X (Twitter)",
    page: "List of most-followed X accounts",
    tables: [0],
    name: "Owner",
    value: "Followers",
    metric: "Followers (millions)",
    aliasCols: ["Username"],
    people: true,
    also: CELEBRITIES,
    // The table's footnote says when its numbers are from.
    dataAsOf: "14 September 2026",
    // Relatives, songs and scandals of the stars: CELEBRITY_JUNK in scripts/aliases.ts. These are this list's own.
    junkAliases: [
      "RIP Harambe", "Strider Sekhar", "Comet Azure", "Blastar", "Environmental policy of the Obama administration",
      "Doe 174", "Trump investigations", "Biden's predecessor", "Incumbent POTUS", "Current POTUS", "NASA Personnel",
      "NASA Grand Prize", "Aerospace Safety Advisory Panel", "Space Systems Center", "India", "F.C.", "Times", "X Money",
      "XMoney",
      // Polls, campaign slogans and NASA programmes among the redirects.
      "Donald Trump popularity", "Trump popularity", "Trump popularity rating", "Donald Trump popularity rating",
      "Trump opinion poll", "Donald Trump opinion poll", "Trump poll", "Trump polls", "Trump poll rating",
      "Donald Trump poll", "Opinion pollings on the Trump presidencies", "Sabka saath, sabka vikas",
      "Sabka saath, sabka vikaas", "Narendra Modi prime ministerial candidacy", "Don’t doubt yer vibe",
      "Don’t Doubt ur Vibe", "Don't doubt yer vibe", "Don't Doubt ur Vibe", "NASA Advisory Council",
      "NASA Center for Autonomous Control Engineering", "NASA Applied Sciences", "NASAcast", "NASA Edge",
    ],
    aliases: {
      NASA: ["National Aeronautics and Space Administration"],
      "Manchester United F.C.": ["Manchester United", "Man United", "Man Utd"],
    },
    // Famous through the other platforms' lists, but with no X account: naming him is free.
    skip: ["Lionel Messi"],
  },
  {
    id: "tiktok-accounts",
    category: "Entertainment",
    title: "Most-followed TikTok accounts",
    noun: "TikTok accounts",
    prompt: "Name the 10 most-followed TikTok accounts",
    page: "List of most-followed TikTok accounts",
    tables: [0],
    name: "Owner",
    value: "Followers",
    metric: "Followers (millions)",
    aliasCols: ["Username"],
    people: true,
    also: [
      { tables: [1], name: "Owner" },
      // The record holders past: Lisa and Lena (no longer ranked) show their count when they took the record,
      // "18.9 million (most-followed in 2017)" (judge, cycle 6). Baby Ariel's row has no date.
      {
        tables: [1],
        name: "Owner",
        where: { col: "Date achieved", match: /\d{4}/ },
        value: "Followers",
        dated: { perYear: { col: "Date achieved" }, label: "most-followed in {year}", unit: " million" },
      },
    ],
    aliases: { IShowSpeed: ["I Show Speed"] },
    junkAliases: [
      "Chandler Hallow", "Ava Kris Tyson", "Chris Tyson", "Nolan Hansen", "Zaira Nucci", "Heidi D'Amelio", "Marc D'Amelio",
      "MrBeast allegations", "T-Series vs MrBeast", "Would You Risk Dying for $500,000?", "Legal issues with TikTok",
      "Project Texas", "TikTok Star", "TikToker", "Tiktokers", "TikTok dance", "TikTok trend", "Dolls", "Dolls EP",
      "FIFA World Cup tiebreakers", "Sports", "League", "The Parades",
      // A first name the surname rule takes from the duo "Lisa and Lena".
      "Lena",
    ],
  },
  {
    id: "spotify-songs",
    category: "Entertainment",
    title: "Most-streamed songs on Spotify",
    noun: "songs",
    prompt: "Name the 10 most-streamed songs on Spotify",
    page: "List of Spotify streaming records",
    tables: [0],
    name: "Song",
    value: "Streams",
    metric: "Streams (billions)",
    works: true,
    also: [{ tables: [4], name: "Song" }],
    universeCategories: ["Billboard Hot 100 number-one singles"],
    titleCase: true,
    // A phrasal verb keeps its capital (the article is "Take On Me").
    rename: { "Take on Me": "Take On Me" },
    aliases: { "Sweet Child O' Mine": ["Sweet Child of Mine"], "7 Rings": ["Seven Rings"] },
  },
  {
    id: "albums",
    category: "Entertainment",
    title: "Best-selling albums",
    noun: "albums",
    prompt: "Name the 10 best-selling albums of all time (claimed sales)",
    page: "List of best-selling albums",
    tables: [1, 2, 3],
    name: "Album",
    value: "sales",
    metric: "Copies sold, claimed (millions)",
    works: true,
    also: [
      { tables: [5], name: "Album" },
      { page: "List of Spotify streaming records", tables: [21], name: "Album" },
    ],
    junkAliases: ["For Crying Out Loud"],
  },
  {
    id: "music-artists",
    category: "Entertainment",
    // Not "best-selling", nor "sales" alone: that reads as the page's claimed-sales ranking (the Beatles, Elvis,
    // Michael Jackson). This ranks certified units, where streams count and featured artists get full credit (Drake
    // is #1), and the title says so.
    title: "Music artists with the most certified sales and streams",
    noun: "artists",
    prompt: "Name the 10 music artists with the most certified units (sales and streams, from available markets)",
    page: "List of best-selling music artists",
    // The claimed-sales tiers ("Over 250 million", ...). Claimed sales tie a lot; certified units rank cleanly.
    tables: [0, 1, 2, 3, 4, 5],
    name: "Artist",
    value: "Total certified units",
    metric: "Certified units",
    people: true,
    // First names everyone uses ("West" is a plain word, so the surname rule gives Kanye none).
    aliases: {
      "Elvis Presley": ["Elvis"],
      "Kanye West": ["Kanye"],
      "Tupac Shakur": ["2Pac", "Tupac"],
      Rihanna: ["RiRi"],
      "Guns N' Roses": ["Guns and Roses", "GNR"],
      // Shorthand fans type (judge, cycle 4): free in classic either way, but only an alias scores in Blitz.
      "Michael Jackson": ["MJ"],
      "Red Hot Chili Peppers": ["RHCP"],
      "Led Zeppelin": ["Led Zep"],
    },
    // Songs, albums, tours, labels, fans and relatives among the redirects: CELEBRITY_JUNK in scripts/aliases.ts.
  },
  {
    id: "concert-tours",
    category: "Entertainment",
    title: "Highest-grossing concert tours",
    noun: "concert tours",
    prompt: "Name the 10 highest-grossing concert tours of all time (not adjusted for inflation)",
    page: "List of highest-grossing concert tours",
    tables: [1],
    name: "Tour title",
    value: "Actual gross",
    metric: "Gross (US$)",
    // Players name the artist: "taylor swift" is The Eras Tour, "coldplay" offers both of theirs.
    aliasCols: ["Artist"],
    also: [
      // Each decade's top 10, worldwide, with its gross; a tour split across two decades (marked *) has only part of
      // its gross in each table, so it is left out.
      { tables: [3, 4, 5, 6, 7], name: "Tour title", value: "Actual gross", aliasCols: ["Artist"], where: { col: "Year", match: /^[^*]*$/ } },
      // The record as it grew, with the record gross: "Steel Wheels/Urban Jungle Tour: $175,000,000 (the record in
      // 1990)". Before the yearly table, whose spelling ("Steel Wheels Tour") is shorter.
      {
        tables: [2],
        name: "Tour title",
        value: "Record gross",
        aliasCols: ["Artist"],
        dated: { perYear: { col: "Year" }, label: "the record in {year}" },
      },
      // Each year's highest-grossing tour, with that year's gross: "Cowboy Carter Tour: #1 in 2025 ($407,600,113)".
      // A tour in both tables shows the newer figure (Steel Wheels' 1990 record, not its 1989 gross).
      {
        tables: [8],
        name: "Tour title",
        value: "Actual gross",
        aliasCols: ["Artist"],
        dated: { perYear: { col: "Year", rank: 1 } },
      },
    ],
    // Ed Sheeran's tours are written in maths symbols, which read as just "tour"; Springsteen's is named by its years.
    rename: {
      "+−=÷× Tour": "Mathematics Tour",
      "÷ Tour": "Divide Tour",
      "2023–2025 Tour": "Springsteen and E Street Band 2023–2025 Tour",
    },
    // Tours the page only has a year's gross for (One Direction's, Bon Jovi's, McCartney's) take the whole tour's
    // gross from its article, so they score in Blitz.
    values: { kind: "gross", below: "last" },
    numberNames: true,
    // A tour is named with or without "World" and "Tour": "M72 Tour", "M72", "1989 Tour", "Cowboy Carter". A short
    // form that is one plain word ("Renaissance", "Divide") is left to the matcher, which reads a name's words.
    stripWords: [/\bworld\b/gi, /\b(world )?tour\b/gi],
    // The surname alone (shared by both of Sheeran's tours: the game asks which), fans' short forms, the usual
    // spelling of "till".
    aliases: {
      "Mathematics Tour": ["The Mathematics Tour", "Sheeran"],
      "Divide Tour": ["The Divide Tour", "Sheeran"],
      "Music of the Spheres World Tour": ["MOTS"],
      "After Hours til Dawn Tour": ["After Hours till Dawn", "After Hours till Dawn Tour"],
    },
    junkAliases: [
      "Tour", "Bruce Springsteen · E Street Band", "2025 Tour", "Springsteen and E Street Band 2023",
      // Concert films, live albums and an attack plot among the redirects.
      "Attempted Taylor Swift concert terrorist plot", "Live in Ahmedabad", "Coldplay - Live in Ahmedabad", "Tutto Passa",
      "Coldplay – Live in Paris", "The Weeknd Live at SoFi Stadium", "Kiss the future tour",
    ],
  },
  {
    id: "animated-films",
    category: "Entertainment",
    title: "Highest-grossing animated films",
    noun: "animated films",
    prompt: "Name the 10 highest-grossing animated films of all time (worldwide)",
    page: "List of highest-grossing animated films",
    tables: [0],
    name: "Title",
    value: "Worldwide gross",
    metric: "Worldwide box office (US$)",
    works: true,
    // The computer-animated, stop-motion and traditionally animated top 50s, each with its worldwide gross: Cars 2,
    // Aladdin and Coraline show and score theirs.
    also: [{ tables: [1, 2, 3], name: "Title", value: "Worldwide gross" }],
    aliases: { "Minions: The Rise of Gru": ["Minions 2"] },
    junkAliases: [
      "Inside Out 3", "Zootopia Three", "Frozen IIII", "Jikŋon 2", "Frozen fandom", "Frozen Reo Māori", "The Lion King 4",
      "The Super Mario Bros. Movie 3", "Pratt Mario",
      // Across the Spider-Verse (#37) is not every Spider-Man film: "spiderman" mostly means Into the Spider-Verse.
      "Spider-Man",
    ],
  },
  {
    id: "media-franchises",
    category: "Entertainment",
    title: "Highest-grossing media franchises",
    noun: "media franchises",
    prompt: "Name the 10 highest-grossing media franchises of all time (all revenue, not just films)",
    page: "List of highest-grossing media franchises",
    tables: [0],
    name: "Franchise",
    value: "Total revenue",
    metric: "Total revenue (US$)",
    universeCategories: ["Media franchises"],
    skip: ["Media franchise"],
    junkAliases: [
      "Joe Merrick", "Serebii", "Fubata town", "Foento City", "Japan Pokemon", "Pokemon Fans", "Pokémon Fans", "Winnie- -Pooh",
      "Winnie Sanders", "Nova 6", "Urzikstan", "Russell Adler", "Captain Marvel", "Gamora", "A Mini Marvel",
      "Summer of Heroes", "MPower", "The Women of Black Panther", "Christie Brezault", "Princess Annika", "Mermaidia",
      "Mariposa and the Butterfly Fairy Friends", "Lance Vance", "San Andreas", "Pokey", "Boo",
    ],
  },
  {
    id: "game-franchises",
    category: "Entertainment",
    title: "Best-selling video game franchises",
    noun: "video game franchises",
    prompt: "Name the 10 best-selling video game franchises of all time",
    page: "List of best-selling video game franchises",
    tables: [0],
    name: "Franchise",
    value: "Sales",
    metric: "Copies sold (millions)",
    universeCategories: ["Video game franchises"],
    // A spin-off article, and sub-series counted in Mario and Final Fantasy (intent.ts gives the series their names).
    skip: [
      "Educational games in the Sonic the Hedgehog series", "Mario Party", "Mario Kart", "Compilation of Final Fantasy VII",
      "Final Fantasy Crystal Chronicles", "Fabula Nova Crystallis Final Fantasy",
    ],
    // Famous franchises the category misses ("uncharted" was corrected to Uncharted Waters, "pacman" to Rayman).
    more: { Uncharted: [], "Pac-Man": ["Pacman", "Pac Man"] },
    junkAliases: [
      "Kamek", "King Boo", "Boo", "Boo Diddley", "E. Gadd", "I have fury!", "Caety Sagoian", "Catey Sagoian", "Mario Clock",
      "Mario Calculator", "POW Block", "Pokemon types", "Pokémon types", "Poke Ball", "Poké Ball", "Pokedex", "Pokédex",
      "Gym Badge", "Elite Four", "Giovanni", "Steven Stone", "Noland", "Sakaki", "Arklay forest", "Raccoon Dam",
      "Caliban Cove", "Nova 6", "Urzikstan", "Russell Adler", "Lance Vance", "Wanted level", "Alex Hunter", "Piemonte Calcio",
      "L-Block", "Tetris music", "Tetrimino", "Tetromino", "Abstergo", "Precursor Genome", "Pokey",
      // Characters, enemies, places, mechanics, soundtracks and a film among the redirects (cycle 1 judge).
      "Kamek the Magikoopa", "Toadsworth", "Koopa kid", "Fire Bro", "Fire Brother", "Toad Town", "Professor E. Gadd",
      "Professor Elvin Gadd", "Lord Fawful", "FawfuI", "Cheep-Cheep", "Bob-Omb", "Bobomb", "Bomb-omb", "Dry Bones",
      "Buzzy Beetle", "Snifit", "Lumalee", "Bloober", "Ignatius Koopa", "Petey Piranha", "Petey Piranah", "Petey Pirahana",
      "Peach's Castle", "Mushroom Kingdom", "Mushroom World", "Super Mario Bros film", "SMB Film", "Mario Takes America",
      "Magikoopa", "Magikoopas", "Boss Boo", "Boomerang Bros", "Boomerang Brothers", "Boomerang Brother", "Sledge Bro",
      "Sledge Bros", "Sumo Bros.", "Ice Bros.", "Gerakobits", "Mario Villains", "Mario Bosses", "Super mario bosses",
      "Mario series enemies", "Mario characters", "Characters in Mario games", "Mario series characters",
      "Mario character list", "Mario characters list", "Super Mario Characters", "Mario Bros. characters",
      "Pokémon moves", "Pokémon move", "Pokémon natures", "Pokémon breeding", "Pokémon evolution", "Pokémon abilities",
      "Pokémon ability", "Pokémon battling", "Pokémon game mechanics", "Gym Leader", "Gym Leaders", "Pokemon Gym Leaders",
      "Gym Badges", "Pokémon Gym", "Pokémon Gyms", "Pokéball", "Giovani", "Professor Odamaki", "Yukinari Ôkido-Hakase",
      "Yukinari Ookido-Hakase", "Pokémon crime syndicates", "Pokémon Trainers", "Pokémon Trainer", "Pokemon characters",
      "Pokémon Professors", "Pokemon Professor", "Pokémon Appearances in Super Smash Bros.",
      "Biohazard 4 Original Soundtrack", "Biohazard Orchestra", "Biohazard Sound Chronicle", "Biohazard Outbreak Soundtrack",
      "Biohazard Outbreak Original Soundtrack", "Resident evil 2 soundtrack", "Resident evil outbreak soundtrack",
      "Biohazard 3 Original Soundtrack", "Biohazard 3 soundtrack", "Resident evil 3 soundtrack",
      "Biohazard Original Soundtrack Remix", "Biohazard Outbreak Origonal Soundtrack", "Biohazard 3 Origonal Soundtrack",
      "Biohazard 5 Original Soundtrack", "Resident Evil Orchestra", "Resident Evil list of books", "The Umbrella Conspiracy",
      "Arklay Forrest", "Arklay Mountains", "Raccoon City Outbreak", "Operation Bacillus Terminate", "Bio-Organic Weapon",
      "Drain Demios", "Abstergo Industries", "Creed's Assassin", "L-BIock", "Lists of Grand Theft Auto characters",
      "FIFA leagues",
    ],
  },
  {
    id: "websites",
    category: "Entertainment",
    title: "Most-visited websites",
    noun: "websites",
    prompt: "Name the 10 most-visited websites in the world (Similarweb ranking)",
    page: "List of most-visited websites",
    tables: [0],
    name: "Website",
    value: "Similarweb",
    metric: "Similarweb rank",
    prefix: "#",
    keepOrder: true,
    lowerIsBetter: true,
    aliasCols: ["Domain"],
    universeCategories: ["Social networking services", "Internet search engines"],
    // The categories also hold articles about the field ("Search engine bias", "Anchor text") and protocols.
    categoryNames: true,
    categorySkip: /^(comparison|issues|privacy|criticism|evaluation|clearinghouse)\b|\b(protocol|search engine|engine|software|framework|project|technologies|corporation|inc\.?|library|index|service|communities)$/i,
    webNames: true,
    junkAliases: [
      "The Parades", "Facebooking", "Binges", "Sonic", "X Money", "XMoney",
      "Giigke,cin", "Ghits", "Google videos", "GoogleYouTube", "Youtubing", "Facephiliac", "Mini-feed",
      "Instagram trends", "Layout from Instagram", "Do Anything Now", "Fail Whale", "Twitpocalypse",
      "Twittered revolution", "AMA", "Subreddit", "Reddit gold", "Infogami", "TikTok Review", "Timeline of WhatsApp",
      "Terabyte unlimited", "Bing Bar",
    ],
  },

  // Batch 2: geography
  {
    id: "us-states-gdp",
    category: "Geography",
    title: "US states with the largest economies",
    noun: "US states",
    prompt: "Name the 10 US states with the largest GDP (2025)",
    page: "List of U.S. states and territories by GDP",
    tables: [1],
    name: "State",
    value: "2025",
    metric: "GDP 2025 (US$ millions)",
    universe: "us-states",
    skip: ["United States", ...NOT_STATES],
    junkAliases: STATE_JUNK,
  },
  {
    id: "europe-cities",
    category: "Geography",
    title: "Largest cities in Europe",
    noun: "cities",
    prompt: "Name the 10 most populous cities in Europe (city limits)",
    page: "List of European cities by population within city limits",
    tables: [0],
    name: "City",
    value: "Official population",
    metric: "Population",
    // EU, UK and Ukrainian cities under 1 million (Lyon, Leeds, Lviv) are answers too, with their population (UK:
    // the city council area, as the main table counts Birmingham). Before CITIES, so Manchester gets its figure.
    also: [
      { page: "List of cities in the European Union by population within city limits", tables: [0], name: "City", value: "Official population" },
      { page: "List of cities in the United Kingdom", tables: [0], name: "City", value: "Population" },
      { page: "List of cities in Ukraine", tables: [0], name: "Name", value: 3 },
      ...CITIES,
    ],
    universe: "capitals",
    junkAliases: [
      "Immigration to Madrid", "Madrilenian cuisine", "Paris culture", "Paris agglomeration", "Washington Place, Berlin",
      "Cecchignola", "Rumeli", "Kotly, Moscow", "Kotly, Moscow Oblast", "Western Moscow", "Baku Oilfields", "Baku Today",
      "Kyiv vs. Kiev", "Kiev vs. Kyiv", "CityBerlin", "Berlin.de", "Silicon Allee", "Paris.fr", "Paris, Banks of the Seine",
      "Londonise", "Londonize", "Four bridges on three lines", "Four bridges on three support", "Cahkt-Netep6ypr",
      "Kiyeff Kiev", "Gente di roma", "Rome, Republic and Empire",
    ],
  },
  {
    id: "india-cities",
    category: "Geography",
    title: "Largest cities in India",
    noun: "cities",
    prompt: "Name the 10 most populous cities in India (city proper, 2011 census)",
    page: "List of cities in India by population",
    tables: [0],
    name: "Name",
    value: "2011",
    metric: "Population (2011 census)",
    skip: ["India"],
    // The NDMC row is the New Delhi council area; a player typing "New Delhi" means Delhi (#2).
    rename: { "New Delhi": "New Delhi Municipal Council" },
    junkAliases: [
      "St. Xavier's High School Loyola Hall", "Prakash Higher Secondary School", "Phss", "Prakash school",
      "Tilak Public School", "Evergreen School", "Rawat Public School", "Rajhans Balvatika",
      "Shri Navinchandra Popatlal Kapadia High School", "Lady Andal Venkatasubbarao MHSS", "Momin High School",
      "Vidyaniketan Public School", "Zydus School", "Hebron High School", "KSLTA Tennis Center",
      "Jai Prakash Narayan National Park", "Ahmedabad Monorail", "Veer Savarkar Sports Complex", "The Gateway Hotel",
      "Lords Plaza", "Hotel Ginger", "Rang Upvan Stadium", "Cold Coco", "Bataka Puri", "Surti Cuisine", "Farmas Biscuit",
      "Adajan", "Athwa", "Kolathur", "Mathikere", "Bibwewadi", "Nanded", "Pune", "Ghouse Nagar Bandlaguda", "Pune weather",
      "Western Presidency", "Kakamuchee", "Galajunkja", "Calixestra", "Dainik Vishwamitra", "Dili", "India", "Delhi",
      "Punjab", "DL", "DEL", "INDEL", "IN-DL", "Eastindians", "Delhiites",
    ],
  },
  {
    id: "canada-cities",
    category: "Geography",
    title: "Largest cities in Canada",
    noun: "cities",
    prompt: "Name the 10 most populous cities in Canada (municipalities, 2021 census)",
    page: "List of the 100 largest municipalities in Canada by population",
    tables: [0],
    name: "Municipality",
    value: "Population (2021)",
    metric: "Population (2021 census)",
    junkAliases: [
      "Highways within Greater Toronto Area", "Toronto, ontario Part 2", "Montreal Skyline", "Team990",
      "Foothills Major Baseball Association", "Fmba", "Calgary Cardinals FMBA", "Prairie Winds Park",
      "National Capital Baseball League", "NCBL", "Antrim, Ontario", "Cedardale, Ottawa, Ontario", "Technically Beautiful",
      "18 Street, Edmonton", "159 Street, Edmonton", "18 Street NW, Edmonton", "Canada's Largest Baseball Bat",
      "Neighbourhoods of Churchill, Mississauga, Ontario", "Sommerville Manor School", "Sommerville Manor",
      "Applewood Acres", "St. Jude's Academy", "The Maples Academy", "Greater Vancouver Bridges",
      "Vancouver Christian School", "Vancouver City Centre, British Columbia", "Rowntree Montessori Schools",
      "Beverly Hills 4, Ontario", "MacNab Street Presbyterian Church", "Eastport Drive", "Pleasant Valley, Hamilton, Ontario",
    ],
  },
  {
    id: "china-cities",
    category: "Geography",
    title: "Largest cities in mainland China",
    noun: "cities",
    prompt: "Name the 10 most populous cities in mainland China (2020 census)",
    page: "List of cities in China by population",
    // Cities over a million, then the 100,000 to 1 million table: one ranking by the same 2020 census.
    tables: [2, 3],
    name: "City",
    value: "2020",
    metric: "Population (2020 census)",
    also: [{ tables: [4], name: "City" }],
    junkAliases: ["Fuxingmen Inner Street", "Fuxingmen Outer Street", "Fuxing Road", "Sichuanese teahouse", "Chien Mei village"],
  },
  {
    id: "deserts",
    category: "Geography",
    title: "Largest deserts",
    noun: "deserts",
    prompt: "Name the 10 largest deserts in the world by area (polar deserts included)",
    page: "List of deserts by area",
    tables: [0],
    name: "Name",
    value: "Area(km",
    metric: "Area",
    unit: " km²",
    stripWords: /\bdesert\b/gi,
    aliases: { "Antarctic Desert": ["Antarctica", "Antarctic"], "Arctic Desert": ["Arctic"] },
    // "Arctic Desert" on Wikipedia is a WWF ecoregion of 161,400 km² (Svalbard and other islands); the list means the
    // whole Arctic polar desert.
    articles: { "Arctic Desert": "Arctic" },
    // Parts of the Great Australian Desert (#5), which already counts their area: not answers of their own.
    skip: [
      "Great Victoria Desert", "Great Sandy Desert", "Tanami Desert", "Simpson Desert", "Gibson Desert",
      "Little Sandy Desert", "Strzelecki Desert",
    ],
    junkAliases: ["Ecoregion PA1314", "Desert of the Gobi", "Arctics"],
  },
  {
    id: "city-visitors",
    category: "Geography",
    title: "Most visited cities",
    noun: "cities",
    prompt: "Name the 10 cities with the most international visitors in 2025",
    page: "List of cities by international visitors",
    tables: [0],
    name: "City",
    value: "Arrivals",
    metric: "Arrivals (millions, 2025)",
    // The page's earlier rankings give a city outside the 2025 top 10 its latest rank and figure: New York City
    // "#8 in 2023 (11.7 million)", Singapore "#5 in 2018 (18.6 million)", Mexico City from Mastercard's 2016 list.
    also: [
      { tables: [1, 2], name: "City", value: "Arrivals", dated: { rank: "Rank", scale: 1e6, unit: " million" } },
      { tables: [3], name: "City", value: "Arrivals 2018", dated: { rank: "Rank (Euromonitor)", scale: 1e6, unit: " million" } },
      {
        tables: [3],
        name: "City",
        value: "Arrivals 2016",
        dated: { rank: "Rank (Mastercard)", source: "Mastercard", scale: 1e6, unit: " million" },
      },
      ...CITIES,
    ],
    universe: "capitals",
    junkAliases: [
      "SJK Lai Meng", "K.L.C.C.", "Al memzar", "Guzelbag Mahallesi", "Kaleici",
      "Krungthepmahanakornamornratanakosinmahintarayutth", "Noble",
    ],
  },
  {
    id: "national-parks",
    category: "Geography",
    title: "Most visited US national parks",
    noun: "national parks",
    prompt: "Name the 10 most visited US national parks in 2025",
    page: "List of national parks of the United States",
    tables: [0],
    name: "Name",
    value: "Recreation visitors",
    metric: "Visitors (2025)",
    stripWords: /\b(national park)\b/gi,
    junkAliases: [
      "Yellowstone Act", "Yellowstone History", "Thunder Hole", "Schoodic Scenic Byway", "Acadia National Park Act of 1919",
      "Gray Wolf Pass", "Graywolf Pass", "Daniel J. Evans Wilderness", "Glacier National Park Act of 1914",
      "Disappearing Glaciers in Glacier National Park", "Crown of the Continent Ecosystem",
      "Establishment of Grand Teton National Park", "Clark",
    ],
  },
  {
    id: "empires",
    category: "Culture",
    title: "Largest empires in history",
    noun: "empires",
    prompt: "Name the 10 largest empires in history by maximum land area",
    page: "List of largest empires",
    tables: [0],
    name: "Empire",
    value: "Million km",
    metric: "Land area (million km²)",
    stripWords: /\b(empire|dynasty|caliphate|colonial|second|first)\b/gi,
    aliases: { "Second French colonial empire": ["French Empire", "French colonial empire"] },
    // Two Xiongnu rows: the smaller is the western state; "Xiongnu" means the empire (intent.ts).
    rename: { Xiongnu: "Western Xiongnu" },
    junkAliases: ["Empire", "British occupation", "British Asia"],
  },
  {
    id: "moons",
    category: "Science",
    title: "Largest moons",
    noun: "moons",
    prompt: "Name the 10 largest moons in the Solar System by radius",
    page: "List of natural satellites",
    tables: [4],
    name: "Name",
    value: "Mean radius",
    metric: "Mean radius",
    unit: " km",
    aliases: { Moon: ["Luna", "Earth's moon"] },
    junkAliases: [
      "Selenology", "Selenologist", "Lunar Science", "Lunar mass", "Moon mass", "Lunar radius", "Moon radius",
      "Moon distance from earth", "Moon in literature", "Moon in culture", "Earth and moon", "Earth-Moon system",
      "Terran System", "Lunar humanization", "Andvari", "Cantaloupe terrain", "Calphurnia", "Lear", "Titan exploration",
      "Ganymede's magnetosphere", "Magnetosphere of Ganymede", "Ganymede magnetic field",
    ],
  },
  {
    id: "museums",
    category: "Culture",
    title: "Most visited museums",
    noun: "museums",
    prompt: "Name the 10 most visited museums in the world (latest annual figures)",
    page: "List of most-visited museums",
    tables: [0],
    name: "Name",
    value: "Visitors",
    metric: "Visitors per year",
    // Not the Paris galleries category: commercial galleries with no visitor figures.
    universeCategories: ["Museums in London", "Museums in New York City"],
    junkAliases: [
      "Suzanne Brenner", "Sloane library", "British Museum Publications", "The British Museum Press",
      "Www.britishmuseum.org", "Sainsbury African Galleries", "Carre gallery", "Salle des etats", "National 9", "11 Museum",
    ],
  },

  // Batch 2: business
  {
    id: "market-cap-peak",
    category: "Business",
    title: "Most valuable companies ever",
    noun: "companies",
    prompt: "Name the 10 companies with the highest market value ever reached (peak, nominal US$)",
    page: "List of public corporations by market capitalization",
    tables: [0],
    name: "Company",
    value: "Nominal",
    metric: "Peak market cap (US$ billions)",
    // The page's quarterly top 10s (2006-2026, US$ millions, the figure in the name cell) and yearly ones
    // (2000-2005) give a company outside the peak ranking its latest place: "ExxonMobil: #8 in Q4 2022 ($454
    // billion)". That is the market value then, labelled with when, not a peak.
    also: [
      ...[8, 6, 4, 2].map((c, i) => ({
        tables: range(1, 21),
        name: c,
        dated: { rank: "Rank", label: `Q${4 - i} {year}`, figureInName: true, scale: 1e3, prefix: "$", unit: " billion" },
        skip: MARKET_CAP_SKIP,
      })),
      {
        tables: range(22, 27),
        name: "Name",
        value: "Market value",
        dated: { rank: "Rank", scale: 1e3, prefix: "$", unit: " billion" },
        skip: MARKET_CAP_SKIP,
        rename: { "Intel Corporation": "Intel" },
      },
      { page: "List of largest companies by revenue", tables: [0], name: "Name" },
    ],
    // Junk among the redirects: COMPANY_JUNK in scripts/aliases.ts, shared by every company list.
    webNames: true,
  },
  {
    id: "banks",
    category: "Business",
    title: "Largest banks",
    noun: "banks",
    prompt: "Name the 10 largest banks in the world by total assets",
    page: "List of largest banks",
    tables: [0],
    name: "Bank name",
    value: "Total assets",
    metric: "Total assets (US$ billions)",
    also: [{ tables: [2], name: "Bank name" }],
    junkAliases: [
      "The Bank of East Asia", "Erica", "Blue chip investor", "Bank of opportunity", "Quick Business Deposit",
      "Global Service Centres", "Global Service Centre", "Orchard Bank", "Alphonse Pinard", ".bnpparibas", "Uni-Éditions",
      "Lukas Bank", "Index Bank", "Project Solidgold", "Beacon Group", "Collegiate Funding Services",
      "EMC Mortgage Corporation", "ICBC.com.cn", "ICBC Leasing",
      ...["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"].map((n) => `BAC Capital Trust ${n}`),
    ],
  },
  {
    id: "richest-people",
    category: "Business",
    title: "Richest people",
    noun: "people",
    prompt: "Name the 10 richest people in the world (Forbes 2026 list)",
    page: "The World's Billionaires",
    tables: [38],
    name: "Name",
    value: "Net worth",
    metric: "Net worth (US$)",
    people: true,
    // Earlier years' top 10s, latest first (a name is spelled as its latest table spells it); each person shows
    // their last appearance ("Bill Gates: #7 in 2024 ($128 billion)"). Forbes and Bloomberg publish no world ranks
    // past #10 on Wikipedia, so near misses take a newer figure from their country's ranking when it has one
    // ("Michael Dell: #10 in the US, 2025 ($129 billion)"): the newest year wins, the world ranking a tie. People
    // who have died are free, not a costly miss ("karl" was Karl Albrecht), and so are families: the list ranks
    // people ("walton family" offers the three Waltons, intent.ts).
    also: [
      {
        tables: range(1, 37).reverse(),
        name: "Name",
        value: "Net worth",
        dated: { rank: "No." },
        skip: [...DECEASED_BILLIONAIRES, ...BILLIONAIRE_FAMILIES, "Steven Ballmer"],
      },
      // "According to Forbes, as of December 2025, the 25 wealthiest people in the United States".
      {
        page: "List of Americans by net worth",
        tables: [0],
        name: "Name",
        value: "Net worth",
        dated: { rank: "Rank", label: "the US, 2025", prefix: "$", unit: " billion" },
        skip: DECEASED_BILLIONAIRES,
      },
      // "India's richest people as per their net worth published by the Forbes (April 2024)".
      {
        page: "List of Indians by net worth",
        tables: [0],
        name: "Name",
        value: "Net worth",
        dated: { rank: "Rank", label: "India, 2024", prefix: "$" },
        skip: DECEASED_BILLIONAIRES,
      },
      // The 2023 Forbes list for France.
      {
        page: "List of French billionaires by net worth",
        tables: [0],
        name: "Name",
        value: "Net worth",
        dated: { rank: "Ranking in France", label: "France, 2023", prefix: "$" },
        skip: DECEASED_BILLIONAIRES,
        rename: { "Jacques Saadé, jr.": "Jacques Saadé Jr." },
      },
    ],
    dataAsOf: "2026",
    // Relatives, organizations and jokes among the redirects to the top 10.
    junkAliases: [
      "Gloria Page", "Lucinda Southworth", "Lucy Southworth", "Lucy Page", "Lucinda Page", "Michael Brin",
      "Maxima Chan", "Max Zuckerberg", "Maxima Zuckerberg", "Maxima Chan Zuckerberg", "August Zuckerberg",
      "Chen Mingyu", "Melanie Craft", "Melanie Ellison", "Melanie Ellison Craft", "Lori Huang", "Astrid Buffett",
      "Astrid Menks", "Astrid Menks Buffett", "Flora Oretaga", "Founder of SpaceX", "Elon Musk advisors",
      "Zuckerberg hearing", "Strider Sekhar", "Comet Azure", "Blastar", "RIP Harambe", "Nash Holdings",
      "Bezos Earth Fund", "No thank you, Mr. Pecker", "The Brin Wojcicki Foundation", "Global Support and Development",
      "Philanthopy of Warren Buffett", "Don’t doubt yer vibe", "Don’t Doubt ur Vibe", "First Lady Elonia Musk",
      "First Lady Elonia", "Elonia Musk", "Toddler ceo", "Arnault family",
    ],
  },
  // Batch 3
  {
    id: "oil-production",
    category: "Business",
    title: "Countries producing the most oil",
    noun: "countries",
    prompt: "Name the 10 countries that produce the most crude oil (January 2026)",
    page: "List of countries by oil production",
    tables: [0],
    name: "Country",
    value: "Crude oil",
    metric: "Thousand barrels per day",
    universe: "countries",
    rename: { Congo: "Republic of the Congo" },
  },
  {
    id: "nobel-countries",
    category: "Culture",
    title: "Countries with the most Nobel laureates",
    noun: "countries",
    prompt: "Name the 10 countries with the most Nobel laureates",
    page: "List of countries by Nobel laureates",
    tables: [0],
    name: "Country",
    value: "Number of Nobel",
    metric: "Nobel laureates",
    universe: "countries",
    junkAliases: ["Swedish sin", "Folkland"],
    // The table's "1–6" counts laureates by several definitions; the list ranks by the low end, so it shows that.
    overrides: { Taiwan: { value: "1", source: "the table's 1–6, at its low end" } },
  },
  {
    id: "military-spending",
    category: "Geography",
    title: "Countries with the biggest military budgets",
    noun: "countries",
    prompt: "Name the 10 countries with the highest military spending",
    page: "List of countries by military expenditures",
    tables: [0],
    name: "Country",
    value: "Spending",
    metric: "Spending (US$ billions)",
    // The share-of-GDP table gives spending for countries the top 40 leaves out (Oman, Azerbaijan).
    also: [{ tables: [2], name: "Country", value: "Military spending" }],
    universe: "countries",
    junkAliases: [
      "Project Meridian", "United States military ranks", "US military branches", "Customs and etiquette in the services",
      "Prince Pickles", "Russian Foreign Legion", "Muscovian army", "Swedish sin",
    ],
  },
  {
    id: "co2-emissions",
    category: "Geography",
    title: "Countries emitting the most CO2",
    noun: "countries",
    prompt: "Name the 10 countries with the highest fossil CO2 emissions (2023)",
    page: "List of countries by carbon dioxide emissions",
    tables: [0],
    name: "Location",
    value: "2023",
    metric: "Million tonnes CO2 (2023)",
    skip: ["European Union post-Brexit", "European Union", "International Shipping", "International Aviation"],
    universe: "countries",
    junkAliases: ["Swedish sin"],
  },
  {
    id: "gdp-per-capita",
    category: "Geography",
    title: "Richest countries per person",
    noun: "countries",
    prompt: "Name the 10 countries with the highest GDP per capita (nominal, IMF 2026)",
    page: "List of countries by GDP (nominal) per capita",
    tables: [0],
    name: "Country/Territory",
    value: "IMF",
    metric: "GDP per capita (US$)",
    universe: "countries",
    // Monaco, Bermuda and the other rows with no IMF figure are free: famous rich places with no rank here.
    unrankedRowsFree: true,
  },
  {
    id: "population-density",
    category: "Geography",
    title: "Densest countries and territories",
    noun: "countries and territories",
    prompt: "Name the 10 most densely populated countries and territories",
    page: "List of countries and dependencies by population density",
    tables: [0],
    name: "Location",
    value: "Density",
    metric: "People per km²",
    universe: "countries",
    junkAliases: [
      "France–Monaco border", "Monaco–France border", "Fort-Hercule", "Monegasque culture", "Monegasque geography",
      "HUB in a Singapore context", "Gibraltar Health Authority", "Gibraltar Group Practice Medical Scheme",
      "Vatican City culture", "Vatican City cuisine", "Vatican citizenship", "Roman Catholicism in Rome",
      "St. Joseph's Fountain", "Fushifarurah", "Iru fushi", "Irufushi",
    ],
  },
  {
    id: "broadway",
    category: "Entertainment",
    title: "Longest-running Broadway shows",
    noun: "Broadway shows",
    prompt: "Name the 10 longest-running Broadway shows by number of performances",
    page: "List of the longest-running Broadway shows",
    tables: [0],
    name: "Title",
    value: "Performances",
    metric: "Performances",
    works: true,
    // Single productions, and a song title two shows share.
    // Single productions, songs and characters (typing "Wonderful" or "Mother" is not naming the show).
    junkAliases: [
      "Chicago The Musical Bangalore", "Phantom — The Las Vegas Spectacular", "Hello!", "Masquerade", "Hannibal",
      "Think of Me", "Angel of Music", "Prima Donna", "Il muto", "Wishing You Were Somehow Here Again", "Mr. Cellophane",
      "We Both Reached for the Gun", "The Morning Report", "Chow Down", "One by One", "Thank Goodness", "Wonderful",
      "A Sentimental Man", "What Is This Feeling?", "Dancing Through Life", "I'm Not That Girl", "Dear Old Shiz",
      "No One Mourns the Wicked", "Angel Reda", "Cassandra", "Coricopat", "Griddlebone", "Heaviside Layer",
      "Red and Black", "Mother", "Tits and Ass", "At The Ballet", "Gimme the Ball", "The Music and the Mirror",
      "You and Me", "Elder Price", "Elder Cunningham", "Kalokairi", "Hasa Diga Eebowai", "I Believe", "Turn It Off",
      "Two by Two", "All American Prophet", "Man Up", "Baptize Me", "Tomorrow Is a Latter Day",
    ],
  },
  {
    id: "manga",
    category: "Entertainment",
    title: "Best-selling manga",
    noun: "manga series",
    prompt: "Name the 10 best-selling manga series of all time",
    page: "List of best-selling manga",
    tables: [0, 1, 2, 3],
    name: "Manga series",
    value: "sales",
    metric: "Copies sold (volumes)",
    works: true,
    junkAliases: [
      "Naruto geography", "Naruto summons", "Naruto jutsu", "Naruto films", "Naruto's World", "Narutonic",
      "Naruto Collectible Card Game", "Naruto card game", "Naruto CCG", "One Piece Party", "One Piece Premier Show",
      "One Piece Anime Guide", "One Piece Collectible Card Game", "One Piece card game", "Song of Doraemon 2",
      "Doraemon Theme", "Doraemon 3D Short Movies", "Doraemon 3D Short",
    ],
  },
  {
    id: "nba-assists",
    category: "Sports",
    title: "NBA career assists leaders",
    noun: "NBA players",
    prompt: "Name the 10 NBA players with the most career assists (regular season)",
    page: "List of National Basketball Association career assists leaders",
    tables: [1],
    name: "Player",
    value: "Total assists",
    metric: "Assists",
    people: true,
    also: [
      { page: "List of National Basketball Association career scoring leaders", tables: [1], name: "Player" },
      { page: "List of National Basketball Association career rebounding leaders", tables: [1], name: "Player" },
    ],
    universeCategories: ["NBA All-Stars"],
    junkAliases: [
      "Khelcey Barrs III", "Khelcey Barrs", "Honor the Gift", "The Announcement", "Magic Johnson Entertainment",
      "Gloria James", "Bronny's dad", "LeBron's son", "Bronny James Sr.", "Natalia Diamante Bryant", "Kobe bryant philanthropy",
      "Mamba Sports Academy", "Exel",
    ],
  },
  {
    id: "nba-rebounds",
    category: "Sports",
    title: "NBA career rebounding leaders",
    noun: "NBA players",
    prompt: "Name the 10 NBA players with the most career rebounds (regular season)",
    page: "List of National Basketball Association career rebounding leaders",
    tables: [1],
    name: "Player",
    value: "Total rebounds",
    metric: "Rebounds",
    people: true,
    also: [
      { page: "List of National Basketball Association career scoring leaders", tables: [1], name: "Player" },
      { page: "List of National Basketball Association career assists leaders", tables: [1], name: "Player" },
    ],
    universeCategories: ["NBA All-Stars"],
    junkAliases: ["Royce Reed", "Dwightmare", "Russell rule", "Bill Russell's rule", "Rim Duncan"],
  },
  {
    id: "nhl-points",
    category: "Sports",
    title: "NHL career points leaders",
    noun: "NHL players",
    prompt: "Name the 10 NHL players with the most career points (regular season)",
    page: "List of NHL players with 1,000 points",
    tables: [0],
    name: 2,
    value: "Pts",
    metric: "Points",
    people: true,
    also: [{ tables: [1, 2], name: "Player", value: "Pts" }, { page: "List of NHL players with 500 goals", tables: [0], name: 2 }],
    universeCategories: ["Hockey Hall of Fame inductees"],
    // Stars below 1,000 points a player names ("eichel" was corrected to Michel Goulet).
    more: { "Auston Matthews": ["Matthews"], "Jack Eichel": ["Eichel"], "Connor McDavid": ["McDavid"] },
    junkAliases: [
      "Trevor Gretzky", "Troy Crosby", "Missus Hockey", "The Howe Family", "Gretzky's Office", "The Trade", "Gretzky trade",
      "Wayne Gretzky Award", "Ovechkin's office", "@ovi8", "Snovechkin", "Cindy Crosby", "Sidney Cry baby", "Sidney Crybaby",
    ],
  },
  {
    id: "mlb-hits",
    category: "Sports",
    title: "MLB career hits leaders",
    noun: "MLB players",
    prompt: "Name the 10 MLB players with the most career hits",
    page: "List of Major League Baseball career hits leaders",
    tables: [1, 2, 3, 4],
    name: "Player",
    value: "Hits",
    metric: "Hits",
    people: true,
    also: [{ page: "List of Major League Baseball career home run leaders", tables: [1, 2, 3, 4], name: "Player" }],
    universeCategories: ["National Baseball Hall of Fame inductees"],
    junkAliases: [
      "Stan Musial Lifetime Achievement Award", "RE2PECT", "Isabella Pujols", "Cynthia Scurtis", "Boli",
      "Barry Bonds 714th home run", "D.Jeter",
    ],
  },
  {
    id: "theme-parks",
    category: "Entertainment",
    title: "Most visited theme parks",
    noun: "theme parks",
    prompt: "Name the 10 most visited theme parks in the world (2024)",
    page: "List of amusement park rankings",
    tables: [1],
    name: "Amusement park",
    value: "2024",
    metric: "Visitors (2024)",
    // The regional tables have the same 2024 figures for parks outside the world top 25 (Knott's Berry Farm, Cedar
    // Point), so those show and score theirs (all 46 have one).
    also: [{ tables: [2, 3, 4, 5], name: "Amusement park", value: "2024" }],
    universeCategories: ["Walt Disney Parks and Resorts", "Operating amusement parks", "Amusement parks in the United States"],
    // Resorts (a guess at "Tokyo Disney" means its parks: intent.ts), companies, services and events are no parks.
    skip: [
      "Tokyo Disney Resort", "Shanghai Disney Resort", "Disneyland Resort", "Hong Kong Disneyland Resort",
      "Disney Vacation Club", "Disney PhotoPass", "Virtual queue systems at Disney Parks", "Give a Day, Get a Disney Day",
      "Disneyland, Inc.", "Euro Disney S.A.S.", "Disney's Fairy Tale Weddings & Honeymoons",
      "Disneyland Resort Paris 15th Anniversary", "Disney Dream Portrait Series", "Disney Live Entertainment",
      "Disney Regional Entertainment", "Disney Experiences", "Adventures by Disney", "Disney Magic Kingdoms", "Club Disney",
      "World of Disney", "Downtown Disney", "Walt Disney Attractions Japan", "Universal Kids Resort",
      "Hale's Tours of the World", "Port Disney", "Universal Beijing",
      // Category members that are no park: a racist carnival game, rides, lands, services, events, never-opened parks.
      "African dodger", "CircusTrix", "Great Old Amusement Parks", "Trolley park", "Behind the Attraction", "E ticket",
      "Go Away Green", "Hidden Mickey", "MagicBand", "MyMagic+", "Omnimover", "Virtual Magic Kingdom",
      "Vista-United Telecommunications", "Wild About Safety", "Mickey's Magical Party", "Mickey's Very Merry Christmas Party",
      "Summer Nightastic!", "Celebration in the Air", "Golden Pass", "Ellen's Energy Adventure", "Pleasure Island",
      "Adventureland", "Disney's America", "Walt Disney's Riverfront Square", "Disneyland in Australia", "WestCOT",
      "Disneyland Abu Dhabi", "The Wizarding World of Harry Potter", "20th Century Fox World", "PlayPlace",
      "Margaritaville Resort Orlando",
      // Category titles skip by their exact text, qualifier included (Adventureland (Iowa) is a real park).
      "Golden Pass (Disney)", "Pleasure Island (Walt Disney World)", "20th Century Fox World (Dubai)",
    ],
    // #10 is the Paris park; "Disneyland Park" reads like #2.
    rename: { "Disneyland Park": "Disneyland Paris" },
    junkAliases: [
      "It's a Small World", "Find Stitch!", "Tokyo Disney Resort Fireworks", "Villain's Mix and Mingle",
      "Magic Kingdom Parade", "Disney's Dreams Come True Parade", "Hard Rock Cafe Osaka",
      "Hard Rock Cafe Universal CityWalk Osaka", "Universal CityWalk Osaka", "Team Disney Anaheim",
      "DisneySea Transit Steamer Line", "Hollywood Hills Amphitheater", "Disney's Doug Live!", "Chante, C'est Noel",
      "Epcot '94", "Epcot '95", "America", "USA Pavilion", "Epcot Pavilion", "World Showcase pavilion",
      "Superstar Television", "The Spirit of Pocahontas", "Streets of America", "Pixar Place", "Critter Country",
      "Disneyland Heliport", "Walt disney project", "Mickey's Soundsational Parade",
    ],
  },
  {
    id: "us-metros",
    category: "Geography",
    title: "Largest US metro areas",
    noun: "metro areas",
    prompt: "Name the 10 most populous metropolitan areas in the United States (2025 estimates)",
    page: "Metropolitan statistical area",
    tables: [0],
    name: "Metropolitan statistical area",
    value: "2025",
    metric: "Population (2025 est.)",
    nameFromText: true,
    nameStrip: /,\s*[A-Z]{2}(-[A-Z]{2})*,?\s+MSA$/,
  },
  {
    id: "capitals",
    category: "Geography",
    title: "Most populous capital cities",
    noun: "capital cities",
    prompt: "Name the 10 most populous national capitals (city proper)",
    page: "List of national capitals by population",
    tables: [0],
    name: "Capital",
    value: "Population",
    metric: "Population",
    // Only capitals are answers: Istanbul, Lagos or Sydney is free ("not one of the capital cities here"), not a
    // life. New Delhi stays as the table has it (the New Delhi council area, 249,998), so "delhi" ranks #148.
    universe: "capitals",
    // Hong Kong is no national capital; its "City of Victoria" in the capitals universe isn't either.
    skip: ["Hong Kong", "City of Victoria"],
    // The capitals universe spells these cities its own way: the same city, not a second (unranked) answer.
    aliases: { Ulaanbaatar: ["Ulan Bator"], "Luxembourg City": ["Luxembourg"], "Djibouti City": ["Djibouti"], Tarawa: ["South Tarawa"] },
    // The table still has the 2011 census.
    overrides: { Dhaka: { value: "10,278,882", source: "Dhaka's article, 2022 census (city)" } },
    junkAliases: [
      "Fuxingmen Inner Street", "Fuxingmen Outer Street", "Fuxing Road, Beijing", "Tokyo Plain", "Jūjō, Tokyo",
      "Tokyo in pop culture", "Kotly, Moscow", "Kotly, Moscow Oblast", "Western Moscow", "Abdeen", "Cairo in the middle ages",
      "Sangwon Middle School", "Five Grand Palaces of Joseon-Dynasty Seoul", "Five Grand Palaces", "Seoul castle",
      "South Seoul", "North Seoul", "Mexican Federal District Transit System", "Londonise", "Londonize", "Baku Oilfields",
    ],
  },
  {
    id: "brazil-cities",
    category: "Geography",
    title: "Largest cities in Brazil",
    noun: "cities",
    prompt: "Name the 10 most populous cities in Brazil (2025 estimates)",
    page: "List of cities in Brazil by population",
    tables: [1],
    name: "Municipality",
    value: "2025",
    metric: "Population (2025 est.)",
    junkAliases: [
      "Fazenda Botafogo", "Fazenda Botafogo, Rio de Janeiro", "Boca do Mato", "Boca do Mato, Rio de Janeiro",
      "Consolação, Rio de Janeiro", "Dadur", "Dadur, Rio de Janeiro", "Distrito Industrial", "Distrito Industrial rio de janeiro",
      "Rio Grande, Rio de Janeiro", "Terreirão do Rio Bonito", "Faz Quem Quer", "Higienopolis",
      "São Paulo International Transport Industry Show", "Vista Alegre", "Vista Alegre, Belo Horizonte",
      "Vista Alegre, Mina Gerais", "Feirinha do largo da ordem", "Rua XV de Novembro", "Curitiba Master Plan",
      "Rua das Flores", "The Flower Street", "Escola Americana do Recife", "Rua da Aurora", "Recife cuisine",
      "Praia do Futuro", "Brasília, Taguatinga", "Lugar de Barra do Rio Negro",
    ],
  },
  {
    id: "us-box-office",
    category: "Entertainment",
    title: "Highest-grossing films in the US",
    noun: "films",
    prompt: "Name the 10 highest-grossing films at the US and Canadian box office (not adjusted)",
    page: "List of highest-grossing films in the United States and Canada",
    tables: [0],
    name: "Title",
    value: "Lifetime gross",
    metric: "US box office (US$)",
    works: true,
    also: [
      { tables: [1], name: "Title" },
      { page: "List of highest-grossing films", tables: [0, 1, 2, 3], name: "Title" },
      { page: "List of highest-grossing animated films", tables: [0, 3], name: "Title" },
    ],
    junkAliases: [
      "Part 2", "Avatar IV", "Inside Out 3", "Frozen IIII", "Jikŋon 2", "Star Wars 10", "Last Skywalker", "Top Gun 3",
      "Untitled third Top Gun film", "The Lion King 4", "The Super Mario Bros. Movie 3", "Zootopia Three",
      "Deadpool & Friend", "Titanic DVD releases", "Titanic DVD Release", "Titanic DVD", "Titanic VHS", "Titanic 5 Disc",
      "Titanic Blu-ray", "Spider-Man 3", "Titanic 4 Disc", "Titanic 5-disc Deluxe Limited Edition",
      "Titanic Special Edition DVD", "Titanic Five Disc Deluxe Limited Edition",
    ],
    // The US and UK titles of one film.
    skip: ["Harry Potter and the Philosopher's Stone"],
  },
  {
    id: "spotify-artists",
    category: "Entertainment",
    title: "Artists with the most monthly Spotify listeners",
    noun: "artists",
    prompt: "Name the 10 artists with the most monthly listeners on Spotify",
    page: "List of most-streamed artists on Spotify",
    tables: [4],
    name: "Artist",
    value: "Monthly listeners",
    metric: "Monthly listeners (millions)",
    people: true,
    also: [
      { tables: [5], name: "Artist" },
      { page: "List of best-selling music artists", tables: [0, 1, 2, 3, 4, 5], name: "Artist" },
    ],
    junkAliases: [
      "Starboy", "King Of The Fall", "We're Alone Together", "Monologue Song", "Lady Gaga as a gay icon",
      "Lady Gaga as gay icon", "Coldplay.com", "Pectoralz", "Los Unidades", "Big Fat Noises", "Shakira Bio",
      "Shakira ft. Wyclef Jean", "Shakira & Alejandro Sanz", "Gypsy Love", "Killa on the Run", "The Hooligans", "Hottest Heart",
      "Insane", "Dolly", "Meow", "Purr", "The Embassy", "Track 5",
    ],
  },
  {
    id: "facebook-pages",
    category: "Entertainment",
    title: "Most-followed Facebook pages",
    noun: "Facebook pages",
    prompt: "Name the 10 most-followed Facebook pages",
    page: "List of most-followed Facebook pages",
    tables: [0],
    name: "Page name",
    value: "Followers",
    metric: "Followers (millions)",
    also: CELEBRITIES,
    // Relatives, songs and scandals of the stars: CELEBRITY_JUNK in scripts/aliases.ts. These are this list's own.
    junkAliases: [
      "T-gay", "Irma Gobb", "Caryn Marooney", "Facebook conspiracy theories", "Conspiracy theories in Facebook groups",
      "Facebook litigation", "10 year challenge", "10 Year Challenge", "Ten year challenge", "Predictions of Facebook's end",
      "Move fast and break things", "The Parades", "Ecce homo qui est faba", "Killer Queen by Katy Perry", "Facebooking",
    ],
  },
  {
    id: "ballon-dor-countries",
    category: "Sports",
    title: "Countries with the most Ballon d'Or wins",
    noun: "countries",
    prompt: "Name the 10 countries whose players have won the most Ballon d'Or awards",
    page: "Ballon d'Or",
    tables: [3],
    name: "Country",
    value: "Wins",
    metric: "Ballon d'Or wins",
    noFigures: "every other country has no Ballon d'Or",
    universe: "countries",
    // Yashin's win counts for the Soviet Union; "Russia" is half right, so it is free rather than a costly miss.
    skip: ["Russia"],
  },
  {
    id: "island-countries",
    category: "Geography",
    title: "Countries with the most islands",
    noun: "countries",
    prompt: "Name the 10 countries with the most islands",
    page: "List of countries by number of islands",
    tables: [0],
    name: "Country",
    value: "No. ofislands",
    metric: "Islands",
    universe: "countries",
    // Parts of the United Kingdom and China, which the table counts again.
    skip: ["Scotland", "Hong Kong"],
  },
  {
    id: "expensive-films",
    category: "Entertainment",
    title: "Most expensive films",
    noun: "films",
    prompt: "Name the 10 most expensive films ever made (estimated cost, not adjusted)",
    page: "List of most expensive films",
    tables: [0],
    name: "Title",
    value: "Cost",
    metric: "Estimated budget (US$)",
    works: true,
    unit: " million",
    // The ranking lists budgets over $200 million; the inflation table's nominal column has the rest (Titanic).
    also: [
      { tables: [2], name: "Title", value: "Nominal" },
      // Each era's record holder with its nominal cost (Ben-Hur, Gone with the Wind, Terminator 2).
      { tables: [3], name: "Production", value: "Cost" },
      { page: "List of highest-grossing films", tables: [0, 2], name: "Title" },
    ],
    junkAliases: [
      "Star Wars 10", "Avatar IV", "Untitled eleventh Fast & Furious film", "The Lion King 4", "Mission", "Impossible",
    ],
    skip: ["Harry Potter and the Sorcerer's Stone"],
  },
  {
    id: "car-makers",
    category: "Business",
    title: "Biggest car makers",
    noun: "car makers",
    prompt: "Name the 10 car makers (groups) that sold the most vehicles in 2025",
    page: "List of manufacturers by motor vehicle production",
    tables: [0],
    name: "Group",
    value: "Sold vehicles(2025)",
    metric: "Vehicles sold (2025)",
    stripWords: /\b(group|motor|motors|auto|company|corporation)\b/gi,
    // The page's earlier years give a group outside the 2025 table its latest rank and figure ("BMW: #12 in 2020
    // (2,324,778)"); a rank column belongs to its table's latest year, so earlier years' columns show a figure only.
    also: [
      { tables: [1], name: 1, value: "Sold vehicles (2020)", dated: { rank: 0 }, rename: { Mercedes: "Mercedes-Benz" } },
      { tables: [2], name: 1, value: "Vehicles (2017)", dated: { rank: 0 } },
      { tables: [2], name: 1, value: "Vehicles (2016)", dated: {} },
      { tables: [2], name: 1, value: "Vehicles (2015)", dated: {} },
      { tables: [3, 4, 5, 9], name: 1, value: "Total", dated: { rank: 0 } },
      { tables: [6, 7, 8, 11, 12], name: 1, value: "Vehicles", dated: { rank: 0 } },
      { tables: [10], name: 1, value: "Vehicles (2004)", dated: {} },
    ],
    universeCategories: ["Car brands"],
    // Brands are their group's answer (intent.ts gives the group their names), not answers of their own.
    skip: [
      "Kia", "Genesis Motor", "Hyundai Motor Company", "Ioniq", "Chevrolet", "Cadillac", "Cadillac V series", "Buick",
      "Jeep", "Dodge", "Ram Trucks", "Chrysler", "Fiat", "Abarth", "Peugeot", "Citroën", "Citroën Racing", "Opel",
      "Vauxhall Motors", "Alfa Romeo", "Alfa Romeo Quadrifoglio", "Maserati", "Lancia", "DS Automobiles", "Fiat-Chrysler",
      "FCA", "PSA Group", "Groupe PSA", "PSA Peugeot Citroën", "Audi", "Porsche", "Škoda Auto", "SEAT", "Cupra",
      "Cupra Racing", "Bentley", "Lamborghini", "Lexus", "Daihatsu", "Acura", "Volvo Cars", "Polestar", "Lotus Cars",
      "MG Cars", "Lincoln Motor Company", "Infiniti", "Datsun", "Maruti Suzuki", "Mercedes", "Tata Motors Passenger Vehicles",
      "Jaguar Cars", "Land Rover", "Mini", "Mini (marque)", "Rolls-Royce Motor Cars",
    ],
    junkAliases: [
      "Toyota sewing machine", "Shigeru Hayakawa", "Controversies surrounding Toyota", "Toyota automobile collectibles",
      "Toyota Financial Savings Bank", "Zeronise", "Shilpan Amin", "EVerybody in", "Controversies surrounding General Motors",
      "General Motors Pension Trust", "GM Pension Trust", "Driving Skills for Life", "Ford Philanthropy", "Auto Motive Power",
      "Ford bestselling models", "Hero honda passion plus", "Cbr 150", "Honda 300ex", "Honda CL145", "Soltec",
      "Honda Soltec", "Honda Werther", "INNOCEAN", "Hyundai Innocean Communications",
      "Yanfeng Global Automotive Interior Systems", "Yanfeng Automotive Interiors", "Songsan Dolphin", "BYD God's Eye",
      "DiLink", "DiPilot", "E-Platform 2.0", "BYD e-Platform", "DM-i", "BYD J6", "Moia", "CARIAD", "Volkswagen Marine",
      "The Power of Dreams", "Honda Clio", "Honda Primo", "Honda Verno", "Honda Outboard", "Honda Marine Group",
      "Built Ford Tough", "Ford Research and Innovation Center", "Ford Advanced Vehicles", "New Auto",
      "Volkswagen Financial Services", "Volkswagen Financial Services AG", "Toyota Financial Services", "Toyota FTAC",
      "Toyota Baltic", "BYD Toyota EV Technology", "GAC BYD", "BYD TianShen", "BYD Dual Mode", "Geely GC2",
      "Geely-Kandi Panda", "General Motors in motorsport",
    ],
  },
  // Oddball: fun lists anyone can throw guesses at, with a surprise or two.
  {
    id: "fast-food-chains",
    category: "Oddball",
    title: "Fast food chains with the most locations",
    noun: "fast food chains",
    prompt: "Name the 10 fast food chains with the most locations worldwide",
    page: "List of the largest fast food restaurant chains",
    tables: [1],
    name: "Name",
    value: "Number of locations",
    metric: "Locations",
    // Each chain's count has its own year; the top 10's are from 2023 to 2026.
    dataAsOf: "2023–2026",
    // Redirects that are products, slogans, promotions, people and places, not names of the chain.
    junkAliases: [
      "QSC&V", "QSCV", "Speedee", "Speedee Service", "Mckinley mac", "McHappy Day", "Big Yellow M", "McDrive", "McBoat",
      "McValue", "McRig", "Franchise Realty Interstate Corp", "Starbucks Mermaid", "Verisimo", "Veristi", "Verista",
      "Verismi", "Starbucks DoubleShot", "Starbucks Entertainment", "Pasqua Coffee", "Trenta", "Race Together", "Cupgate",
      "Cup-gate", "Donte Robinson", "Stars and Bucks Cafe", "Veggie Delite", "Sandwich artist", "BMT", "Five dollar footlong",
      "Subway $5 footlong promotion", "5 dollar footlong", "Eat Fresh", "Colonel Sanders", "Family Feast", "KFC Famous Bowls",
      "KFC in India", "Zinger Burger", "Kentucky Grilled Chicken", "KFC products", "KFC Dipping Platter",
      "Finger lickin' good", "KFC Eleven", "KFC Mashed Potato Bowl", "KFC 11", "KFC11", "KFC Chicken Nuggets",
      "Sanders Court & Café", "KFC in Pakistan", "Kentucky Fried Chicken in Pakistan", "It's Finger Lickin' Good!",
      "Bucket meal", "KFC bucket meal", "Fudgems", "Super Six Mix", "Oreo Pizza", "Leaning Tower of Pizza", "Kristy Hammonds",
      "Michael Setzer", "30 minutes or it's free", "30-minute guarantee", "Domino's pizza tracker", "James Monaghan",
      "Dominick DeVarti", "Tom Monaghan's Leaning Tower of Pizza", "MeatZZa", "Cinnastix", "Thin n Crispy",
      "4-for-all pizza", "Book It", "The Pizza Head Show", "Pizza Head", "Pasta hut", "Pizza Hut P'Zones",
      "Pizza Hut Stuffed Crust Pizza", "Crown Crust Pizza", "Crown Crust Carnival", "No one outpizzas the hut", "PizzaNet",
      "Italian Taco", "The Burger King Kids Club Gang", "Big Kids Meal", "Be Your Way", "King Jr Meal", "King Deals",
      "Zesty sauce", "Taste is king",
    ],
  },
  {
    id: "us-surnames",
    category: "Oddball",
    title: "Most common surnames in the US",
    noun: "surnames",
    prompt: "Name the 10 most common surnames in the United States (2020 census)",
    page: "List of most common surnames in North American countries",
    tables: [9],
    name: "Name",
    value: "Count 2020",
    metric: "People (2020 census)",
    noRedirects: true,
    skip: ["First 20"],
    // Canada's, Mexico's and Central America's common surnames: real surnames, all outside the US top 10.
    also: [
      { tables: [0, 2, 3, 4, 5, 6, 7, 8], name: "Surname" },
      { tables: [1], name: 1 },
      { tables: [1], name: 2 },
      { tables: [1], name: 3 },
      { tables: [1], name: 4 },
      { tables: [1], name: 5 },
    ],
  },
  {
    id: "tea-per-capita",
    category: "Oddball",
    title: "Countries that drink the most tea per person",
    noun: "countries",
    prompt: "Name the 10 countries that drink the most tea per person",
    page: "List of countries by tea consumption per capita",
    tables: [0],
    name: "Country",
    value: "Tea consumption",
    metric: "Kilograms of tea per person per year",
    unit: " kg",
    universe: "countries",
    junkAliases: ["Science in Aotearoa"],
  },
  {
    id: "girls-names",
    category: "Oddball",
    title: "Most common girls' names in the US",
    noun: "girls' names",
    prompt: "Name the 10 most common names for baby girls born in the US from 1926 to 2025",
    page: "Popularity of birth names for females (United States)",
    tables: [0],
    name: "name",
    value: "rank",
    metric: "Rank, 1926-2025 (Social Security records)",
    dataAsOf: "2025",
    prefix: "#",
    keepOrder: true,
    lowerIsBetter: true,
    noRedirects: true,
  },
  {
    id: "boys-names",
    category: "Oddball",
    title: "Most common boys' names in the US",
    noun: "boys' names",
    prompt: "Name the 10 most common names for baby boys born in the US from 1926 to 2025",
    page: "Popularity of birth names for males (United States)",
    tables: [0],
    name: "name",
    value: "rank",
    metric: "Rank, 1926-2025 (Social Security records)",
    dataAsOf: "2025",
    prefix: "#",
    keepOrder: true,
    lowerIsBetter: true,
    noRedirects: true,
  },
  {
    id: "beer-per-capita",
    category: "Oddball",
    title: "Countries that drink the most beer per person",
    noun: "countries",
    prompt: "Name the 10 countries that drink the most beer per person",
    page: "List of countries by beer consumption per capita",
    tables: [0],
    name: "Country",
    value: "Consumption per capita",
    metric: "Litres of beer per person per year",
    unit: " L",
    universe: "countries",
  },
  {
    id: "passwords",
    category: "Oddball",
    title: "Most common passwords",
    noun: "passwords",
    prompt: "Name the 10 most common passwords (NordPass 2025)",
    page: "List of the most common passwords",
    tables: [0],
    name: "Password",
    value: "Count",
    metric: "Accounts using it (NordPass 2025)",
    dataAsOf: "2025",
    numberNames: true,
    notWords: true,
    noRedirects: true,
    // "!@$%&" normalizes to "and".
    skip: ["!@$%&"],
    // The other surveys' lists (Huntress 2026, SplashData by year, NCSC, Keeper): common passwords outside
    // NordPass's top 20, each with its latest rank on one of them ("qwerty: #14 in 2026 (Huntress)").
    also: [
      { tables: [4], name: "Password", dated: { rank: "Rank", label: "2026", source: "Huntress" } },
      ...range(1, 9)
        .reverse()
        .map((c) => ({ tables: [1], name: c, dated: { rank: "Rank", source: "SplashData" } })),
      { tables: [3], name: 1, dated: { rank: "Rank", source: "NCSC" } },
      { tables: [2], name: 1, dated: { rank: "Rank", source: "Keeper" } },
    ],
  },
  // Cycle 3
  {
    id: "athletes-earnings",
    category: "Sports",
    // Forbes ranks a year's earnings, endorsements included: the title says whose list and the measure. The 2026
    // list covers the 12 months to spring 2026, not the calendar year.
    title: "Highest-paid athletes on Forbes' 2026 list",
    noun: "athletes",
    prompt: "Name the 10 highest-paid athletes on Forbes' 2026 list (salary and winnings plus endorsements)",
    page: "Forbes list of the world's highest-paid athletes",
    tables: [0],
    name: "Name",
    value: "Total",
    metric: "Earnings incl. endorsements (US$)",
    dataAsOf: "2026",
    people: true,
    // Only the last two years count against the player. With every top 10 since 2012 accepted, the past stars a
    // casual player tries after the easy four (Tiger, Federer, Mayweather, Brady, Djokovic) each cost a life, and the
    // game ended before Durant or Canelo (judge, cycle 4). Now they are free.
    also: [
      // The 2025 and 2024 top 10s, latest first: a miss shows its last appearance ("Kylian Mbappé: #6 in 2024
      // ($110 million)").
      { tables: [1, 2], name: "Name", value: "Total", dated: { rank: "Rank" } },
      // Athletes who earned $100 million in 2024 or later without making that year's top 10: "Joe Burrow: $100
      // million+ (2024)". Not the ones whose last such year is older (Mayweather, Federer, McGregor).
      {
        tables: [18],
        name: "Name",
        where: { col: "$100 million+", match: /\b202[4-9]\b/ },
        dated: { perYear: { col: "$100 million+" }, figure: "$100 million+" },
      },
    ],
    // Fights, relatives, staff, companies, pets and jokes among the redirects: CELEBRITY_JUNK, shared with the
    // career lists, where these stars rank too.
  },
  {
    id: "car-models",
    category: "Business",
    title: "Best-selling car models of all time",
    noun: "car models",
    prompt: "Name the 10 best-selling car models (nameplates) of all time",
    page: "List of best-selling automobiles",
    tables: [0],
    name: "Nameplate",
    value: "Units sold",
    metric: "Units sold",
    // Named "Make Model", the way people say them, like the pool's "Toyota Prius": "toyota" alone then reads as
    // Toyota's models, top 10 first (named by model only, the brand offered only the pool's Toyotas, each costing a
    // life). The model alone ("Corolla") is an alias.
    also: [
      // The record holders (the Model T) and each brand's best seller, current and defunct, with units sold.
      { tables: [1], name: "Automobile", value: "Units sold" },
      {
        tables: [2, 3],
        name: "Automobile",
        value: "Units sold",
        rename: { Series: "Land Rover Series", Metropolitan: "Nash Metropolitan" },
      },
      // Each class's best seller (Mustang, Prius, MX-5).
      { tables: [4], name: "Automobile", value: "Units sold", rename: { "Iso/BMW/VELAM/Romi Isetta": "Isetta" } },
    ],
    // Platforms, concepts, a lawsuit, maintenance and plain words ("Bug", "Rabbit": "vw bug" still works) among the
    // redirects.
    junkAliases: [
      "GM S platform", "Hybrid Electric Vehicle Technologies", "Ford 6+6 trucks", "Eluminator", "Peters v. Honda", "Dogbot",
      "V2CII", "Ford Verve concepts", "Beetle restoration", "Toyota Truck Maintenance", "Toyota Truck Maintainence",
      "Toyota Hilux platform", "Toyota Hi-Lux platform", "Gyurza patrol vehicle", "Toyota Recreational Vehicles",
      "Toyota Taliban", "TruckMasters OX", "Toyota Hilux FCEV concept", "Bug", "Rabbit", "Beetle car",
      // Plain words left from the brand tables' cells ("Series" cost a life as the Land Rover Series), and cells
      // that glue several models into one string (their models are aliases in scripts/intent.ts).
      "Series", "Metropolitan", "Series/Defender", "Nissan Sunny/Sentra/Pulsar/Almera", "VAZ-2105/04/07",
      "Iso/BMW/VELAM/Romi Isetta",
    ],
    // The model alone, as people also say it; the trucks are sold by their model numbers; the Golf was the Rabbit in
    // North America.
    aliases: {
      "Toyota Corolla": ["Corolla"],
      "Ford F-Series": ["F-Series", "F-150", "Ford F-150", "F-250"],
      "Volkswagen Golf": ["Golf", "VW Golf", "Volkswagen Rabbit", "VW Rabbit"],
      "Volkswagen Passat": ["Passat", "VW Passat"],
      "Honda Civic": ["Civic"],
      "Toyota Camry": ["Camry"],
      "Ford Fiesta": ["Fiesta"],
      "Volkswagen Beetle": ["Beetle", "VW Beetle", "Volkswagen Bug", "VW Bug"],
      "Toyota Hilux": ["Hilux"],
      "Honda Accord": ["Accord"],
    },
  },
  // Cycle 4
  {
    id: "netflix-seasons",
    category: "Entertainment",
    // Netflix ranks seasons (and limited series), English and not, by views in their first 91 days; films are a
    // table of their own and not answers here. The page keeps only the top 10, one combined table.
    title: "Netflix seasons with the most views in their first 91 days",
    noun: "Netflix series",
    prompt: "Name the 10 most-watched seasons of Netflix series (views in their first 91 days; a series can be in it more than once)",
    page: "List of most-watched Netflix original programming",
    tables: [1],
    name: "Title",
    value: "Views",
    metric: "Views in the first 91 days (millions)",
    part: "Season",
    works: true,
    // The anthology's first season has a title of its own, which is how people know it.
    rename: { "Monster (Season 1)": "Monster: The Jeffrey Dahmer Story" },
    articles: { "Monster: The Jeffrey Dahmer Story": "Monster: The Jeffrey Dahmer Story" },
    aliases: { "Monster: The Jeffrey Dahmer Story": ["Monster", "Dahmer", "Jeffrey Dahmer"] },
    // Episodes, attractions, shops, characters and the novels among the redirects.
    junkAliases: [
      "One More Game", "Byeori binnaneun bame", "Stranger Things Experience", "Stranger Things Store",
      "Stranger Things popup", "The Duke and I", "Penelope Bridgerton", "Viscount Bridgerton", "Violet Bridgerton",
      "Romancing Mister Bridgerton", "The One About Matthew Perry",
    ],
    // Only seasons with a figure are answers; every other show is free. The pool used to be all 2,372 Netflix
    // originals, each costing a life with no figure to learn from (judge, cycle 5), and their words offered obscure
    // shows (14.3% of the leak audit's wrong guesses: "cars" Comedians in Cars Getting Coffee). Netflix's ranking
    // stops at 10; these two seasons' 91-day views are in their articles. The Queen's Gambit and the others just
    // past the cut have no such figure on Wikipedia. The originals stay known names (`knownOnly`): every Netflix
    // original series, current and ended (scripted, docuseries, reality, continuations, co-productions), named by the
    // title as written.
    knownOnly: (
      [
        ["List of Netflix original programming", range(0, 47)],
        ["List of ended Netflix original programming (2012–2015)", [...range(0, 7), ...range(9, 14)]],
        ["List of ended Netflix original programming (2016–2020)", [...range(0, 21), ...range(23, 30)]],
        ["List of ended Netflix original programming (2021–2025)", [...range(0, 29), ...range(31, 35)]],
        ["List of ended Netflix original programming (2026–present)", [...range(0, 6), ...range(8, 10)]],
      ] as const
    ).map(([page, tables]) => ({ page, tables: [...tables], name: "Title", nameFromText: true })),
    cited: {
      "Money Heist (Part 4)": {
        value: "106 million views",
        n: 106,
        aliases: ["Money Heist", "Money Heist 4", "Money Heist Part 4", "La Casa de Papel", "Casa de Papel", "La Casa de Papel 4"],
        source: "Money Heist: part 4 had \"106 million views\" on Netflix's most popular non-English TV list (TheWrap, Feb 2024)",
      },
      "Bridgerton (Season 3)": {
        value: "106 million views",
        n: 106,
        aliases: ["Bridgerton 3", "Bridgerton S3"],
        source: "Bridgerton: Season 3 sixth on Netflix's all-time top 10, \"846.5 million hours viewed/106 million views\" (Jan 2025)",
      },
    },
  },
  {
    id: "mcdonalds-countries",
    category: "Oddball",
    title: "Countries with the most McDonald's restaurants",
    noun: "countries",
    prompt: "Name the 10 countries with the most McDonald's restaurants",
    page: "List of countries with McDonald's restaurants",
    tables: [0],
    name: "Country/territory",
    value: "No. of operating outlets",
    metric: "McDonald's restaurants",
    dataAsOf: "December 2025",
    universe: "countries",
    // Every country (and territory) with a McDonald's is an answer; one that never had one is free.
    universeNamesOnly: true,
    also: [
      // Countries it has left, with their count at closing: "Russia: 850 (all closed in 2022)".
      {
        tables: [1],
        name: "Country/territory",
        value: "Number of stores",
        dated: { perYear: { col: "Date of closure" }, label: "all closed in {year}" },
      },
    ],
  },
  // Cycle 5
  {
    id: "dog-breeds",
    category: "Oddball",
    // The AKC counts purebred registrations: doodles and pit bulls aren't in it, so the title names the measure.
    title: "Most popular dog breeds in the US (AKC registrations, 2025)",
    noun: "dog breeds",
    prompt: "Name the 10 most popular dog breeds in the US by American Kennel Club registrations in 2025",
    page: "List of most popular dog breeds",
    // "Club registration figures for 2025": the AKC's top 10, ranks only.
    tables: [17],
    name: "Breed",
    value: "Position",
    metric: "AKC rank (registrations, 2025)",
    dataAsOf: "2025",
    prefix: "#",
    keepOrder: true,
    lowerIsBetter: true,
    // The cells say "Laborador Retriever" once, so names come from the links, which say "French Bulldogs" and
    // "Poodles" (redirects): the breeds go by their articles' names.
    nameFromLink: true,
    rename: DOG_NAMES,
    also: [
      // The AKC's earlier top 10s, newest first: a breed that left shows its last rank ("Pembroke Welsh Corgi: #10 in
      // 2019", "Yorkshire Terrier: #2 in 2008"). The 2006-2008 tables sit under headings that also hold the UK's and
      // Canada's, so they are named here.
      ...[16, 15, 14, 13, 12, 11].map((t) => ({ tables: [t], name: "Breed", nameFromLink: true, rename: DOG_NAMES, dated: { rank: "Position" } })),
      ...([[6, "2008"], [3, "2007"], [1, "2006"]] as const).map(([t, label]) => ({
        tables: [t],
        name: "Breed",
        nameFromLink: true,
        rename: DOG_NAMES,
        dated: { rank: "Position", label },
      })),
    ],
    // Other breeds and crosses among the redirects ("Shiloh Shepherd", "Labradog"), the breed type ("Retriever",
    // "Pointer": the game asks which), a nickname of one dog and a lab's beagles. "Golden lab" stays the Labrador's
    // (a yellow lab); "golden" alone is the Golden Retriever.
    junkAliases: [
      "Dudley", "Retriever", "Pointer", "Shiloh Shepherd dog", "Shiloh Shepherds", "Shiloh Shepherd", "King Shepherd",
      "Panda Shepherd", "Czech Shepherd", "East German Shepherd Dog", "Schniebley", "German sheperds in war",
      "Alsatian Wolf Dog", "Russian tracker", "Russian Retriever", "Red Retriever", "Liberty pups", "Laboratory beagle",
      "Weily", "Vorsteh", "Vorsteher", "Lab Mix", "Labradog", "New English Bulldog",
    ],
    // Every breed the FCI recognizes (357), and the AKC's own breeds the FCI doesn't (`more`), so a real breed
    // outside the top 10 costs a life; a crossbreed or a breed neither registry has (goldendoodle, pit bull) is free.
    universeCategories: ["FCI breeds"],
    // The names a US owner knows them by (the AKC's), where the article goes by another.
    categoryRename: {
      "Dalmatian dog": "Dalmatian",
      "Havanese dog": "Havanese",
      "Maltese dog": "Maltese",
      "Newfoundland dog": "Newfoundland",
      "Pomeranian dog": "Pomeranian",
      "Puli dog": "Puli",
      "Pumi dog": "Pumi",
      "Samoyed dog": "Samoyed",
      "Shikoku dog": "Shikoku",
      Dobermann: "Doberman Pinscher",
      "Continental Toy Spaniel": "Papillon",
      "Pyrenean Mountain Dog": "Great Pyrenees",
      "Griffon Bruxellois": "Brussels Griffon",
      "Chinese Crested Dog": "Chinese Crested",
      "Pointer (dog breed)": "English Pointer",
      Xoloitzcuintle: "Xoloitzcuintli",
    },
    // AKC breeds the FCI category leaves out.
    more: {
      "Cardigan Welsh Corgi": ["Cardigan Corgi"],
      "American Eskimo Dog": ["American Eskimo", "Eskie"],
      "American Hairless Terrier": [],
      "American English Coonhound": [],
      "Anatolian Shepherd Dog": ["Anatolian Shepherd"],
      "Biewer Terrier": [],
      "Bluetick Coonhound": ["Bluetick"],
      "Boerboel": [],
      "Boykin Spaniel": [],
      Chinook: [],
      "Plott Hound": ["Plott"],
      "Rat Terrier": [],
      "Redbone Coonhound": ["Redbone"],
      "Toy Fox Terrier": [],
      "Treeing Walker Coonhound": ["Treeing Walker", "Walker Coonhound"],
    },
    // Crossbreeds are free, but real names: "labradoodle" is never read as a typo of Labrador.
    knownOnly: [
      {
        page: "List of dog crossbreeds",
        tables: [0],
        name: "Name",
        // Two names in one cell: each is a name of its own (below).
        rename: { "Cavoodle or Cavapoo": "Cavapoo", "Jackabee or Jack-A-Bee": "Jackabee" },
      },
    ],
    // The usual spellings of the doodles and other designer crosses the page leaves out (judge, cycle 6): with the
    // matcher reading a spaced guess by its spaceless form, "aussie doodle" and "yorkie poo" are these, free.
    knownNames: [
      "Cavoodle", "Jack-A-Bee", "Aussiedoodle", "Aussiepoo", "Bernese Doodle", "Bernesedoodle", "Yorkipoo",
      "Golden Mountain Doodle", "Mini Goldendoodle", "Mini Labradoodle", "Pomsky", "Pitsky", "Shorkie", "Peekapoo",
      "Bordoodle", "Newfypoo", "Saint Berdoodle", "Boxador", "Frenchton", "Cavapoochon", "Maltipom", "Huskydoodle",
      "Doxiepoo", "Shepadoodle",
    ],
    noFigures: "the AKC's ranks past 10 aren't on Wikipedia; breeds from its earlier top 10s show their last rank",
    // How owners say them.
    aliases: {
      "French Bulldog": ["Frenchie", "Frenchies", "French Bulldogs", "Frenchy"],
      "Labrador Retriever": ["Lab", "Labs", "Labrador", "Labradors", "Labrador Retrievers", "Black Lab", "Black Labrador"],
      "Golden Retriever": ["Golden", "Goldens", "Golden Retrievers", "Goldie"],
      "German Shepherd": ["GSD", "German Shepherd Dog", "German Shepherds", "Alsatian"],
      Dachshund: ["Doxie", "Wiener dog", "Weiner dog", "Sausage dog", "Dachshunds", "Daschund"],
      Poodle: ["Poodles", "Standard Poodle", "Toy Poodle", "Miniature Poodle", "Mini Poodle", "French Poodle"],
      Beagle: ["Beagles"],
      Rottweiler: ["Rottie", "Rottweilers"],
      "German Shorthaired Pointer": ["GSP", "Shorthaired Pointer", "German Shorthair"],
      Bulldog: ["English Bulldog", "British Bulldog", "Bulldogs"],
    },
  },
];

/** Table indexes from..to, inclusive. */
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
