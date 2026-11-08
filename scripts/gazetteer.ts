import { createRequire } from "node:module";
import { normalize } from "../src/game/match";
import { COUNTRY_FORMS } from "./intent";

const require = createRequire(import.meta.url);

export interface Place {
  name: string;
  aliases: string[];
  /** The country a place inside one is in (a capital's), for regional lists. */
  country?: string;
}

interface CountryData {
  name: string;
  native: string;
  alias?: string[];
  capital: string;
  continent: string;
  /** Transcontinental countries only: every continent they reach ("AS", "EU" for Russia). */
  continents?: string[];
}

const DATA = () =>
  require("countries-list") as { countries: Record<string, CountryData>; continents: Record<string, string> };

/** Every country and territory, with its native name. */
export function countries(): Place[] {
  return Object.values(DATA().countries).map((c) => ({
    name: c.name,
    aliases: [c.native].filter((a) => a && a !== c.name),
  }));
}

export function capitals(): string[] {
  return capitalPlaces().map((c) => c.name);
}

/** Every country's capital, with its country. */
function capitalPlaces(): Place[] {
  return Object.values(DATA().countries)
    .filter((c) => c.capital)
    .map((c) => ({ name: c.capital, aliases: [], country: c.name }));
}

export type Continent = "Africa" | "Antarctica" | "Asia" | "Europe" | "North America" | "Oceania" | "South America";
/**
 * Where a regional list's answers are: a continent ("Europe") or one country ("China"). Its universe and its other
 * pages' tables add answers from there; their places outside it are `elsewhere` entries (build.ts).
 */
export type Region = Continent | (string & {});

export interface Country {
  name: string;
  continents: Continent[];
}

/**
 * Continents countries-list gives a country through a territory it also lists apart: Denmark reaches North America
 * only by Greenland (its own entry, GL), so Copenhagen is plainly in Europe.
 */
const CONTINENTS_APART: Record<string, string[]> = { DK: ["NA"] };

/**
 * Places tables name as a country that countries-list lacks, by the entry they count under (breakaway states by
 * their de jure country): Tiraspol is Moldova's, so Europe's. "Congo" alone is the Republic (both are Africa's).
 */
const PLACES_UNDER: Record<string, string> = {
  Transnistria: "Moldova",
  "Northern Cyprus": "Cyprus",
  Abkhazia: "Georgia",
  "South Ossetia": "Georgia",
  Somaliland: "Somalia",
  "Sahrawi Arab Democratic Republic": "Western Sahara",
  "Hong Kong SAR": "Hong Kong",
  "Macau SAR": "Macao",
  "Cocos Islands": "Cocos (Keeling) Islands",
  Congo: "Republic of the Congo",
};

let COUNTRY_BY_NAME: Map<string, Country> | undefined;

/**
 * The country a name means (countries-list's name, native name or alias, or a form in COUNTRY_FORMS: "Czech
 * Republic", "Holland"), with its continents (several for a transcontinental country). Undefined for a name that is
 * no country (or one countries-list lacks: "Soviet Union", "Somaliland").
 */
export function countryOf(name: string): Country | undefined {
  if (!COUNTRY_BY_NAME) {
    const { countries, continents } = DATA();
    COUNTRY_BY_NAME = new Map();
    for (const [code, c] of Object.entries(countries)) {
      const keys = (c.continents ?? [c.continent]).filter((k) => !CONTINENTS_APART[code]?.includes(k));
      const country = { name: c.name, continents: keys.map((k) => continents[k] as Continent) };
      for (const n of [c.name, c.native, ...(c.alias ?? [])]) if (n && !COUNTRY_BY_NAME.has(normalize(n))) COUNTRY_BY_NAME.set(normalize(n), country);
    }
    for (const forms of COUNTRY_FORMS) {
      const country = forms.map((f) => COUNTRY_BY_NAME!.get(normalize(f))).find(Boolean);
      if (country) for (const f of forms) if (!COUNTRY_BY_NAME.has(normalize(f))) COUNTRY_BY_NAME.set(normalize(f), country);
    }
    for (const [place, under] of Object.entries(PLACES_UNDER)) {
      const country = COUNTRY_BY_NAME.get(normalize(under));
      if (!country) throw new Error(`gazetteer: "${place}" counts under "${under}", which is no country`);
      if (!COUNTRY_BY_NAME.has(normalize(place))) COUNTRY_BY_NAME.set(normalize(place), country);
    }
  }
  return COUNTRY_BY_NAME.get(normalize(name.replace(/[*†‡]/g, "")));
}

const CONTINENTS = new Set<string>(["Africa", "Antarctica", "Asia", "Europe", "North America", "Oceania", "South America"]);
export const isContinent = (region: Region): region is Continent => CONTINENTS.has(region);

/**
 * Where a country is, for a regional list: "inside" the region, "outside" it (Japan for Europe: a guess costs a
 * life and says "Japan isn't in Europe."), or "unsure": a transcontinental country (Russia, Turkey, Egypt,
 * Kazakhstan, Azerbaijan, Georgia) reaching the region that the source page leaves out (`listed`: the countries its
 * table's rows name). Its region is debatable, so it and its cities stay free: Egypt on the Asian list, Ankara on
 * the European one. Where the page lists it, it is inside. Undefined for a name that is no known country.
 */
export type Where = "inside" | "outside" | "unsure";

export function whereIs(country: string, region: Region, listed: ReadonlySet<string> = new Set()): Where | undefined {
  const c = countryOf(country);
  if (!c) return undefined;
  if (!isContinent(region)) return c.name === (countryOf(region)?.name ?? region) ? "inside" : "outside";
  if (!c.continents.includes(region)) return "outside";
  return c.continents.length === 1 || listed.has(c.name) ? "inside" : "unsure";
}

/** Whether a country is inside a region (see whereIs); undefined for a name that is no known country. */
export function inRegion(country: string, region: Region, listed: ReadonlySet<string> = new Set()): boolean | undefined {
  const w = whereIs(country, region, listed);
  return w && w === "inside";
}

/**
 * Some of the world's largest cities that are no capital, with their country: with the capitals, enough for
 * scripts/validate.ts to tell when a regional city list has taken in the world's cities.
 */
export const MAJOR_CITIES: [string, string][] = [
  ["Shanghai", "China"], ["Guangzhou", "China"], ["Shenzhen", "China"], ["Chongqing", "China"], ["Chengdu", "China"],
  ["Mumbai", "India"], ["Kolkata", "India"], ["Bangalore", "India"], ["Chennai", "India"], ["Karachi", "Pakistan"],
  ["Lahore", "Pakistan"], ["Osaka", "Japan"], ["Ho Chi Minh City", "Vietnam"], ["São Paulo", "Brazil"],
  ["Rio de Janeiro", "Brazil"], ["New York City", "United States"], ["Los Angeles", "United States"],
  ["Chicago", "United States"], ["Houston", "United States"], ["Lagos", "Nigeria"], ["Johannesburg", "South Africa"],
  ["Alexandria", "Egypt"], ["Toronto", "Canada"], ["Sydney", "Australia"], ["Melbourne", "Australia"], ["Dubai", "United Arab Emirates"],
];

/** The countries a city is known to be in (as a capital, or one of MAJOR_CITIES); empty for any other name. */
export function citysCountries(city: string): string[] {
  const n = normalize(city);
  return [
    ...capitalPlaces().filter((c) => normalize(c.name) === n).map((c) => c.country!),
    ...MAJOR_CITIES.filter(([name]) => normalize(name) === n).map(([, country]) => country),
  ];
}

const US_STATES: [string, string][] = [
  ["Alabama", "AL"], ["Alaska", "AK"], ["Arizona", "AZ"], ["Arkansas", "AR"], ["California", "CA"],
  ["Colorado", "CO"], ["Connecticut", "CT"], ["Delaware", "DE"], ["Florida", "FL"], ["Georgia", "GA"],
  ["Hawaii", "HI"], ["Idaho", "ID"], ["Illinois", "IL"], ["Indiana", "IN"], ["Iowa", "IA"],
  ["Kansas", "KS"], ["Kentucky", "KY"], ["Louisiana", "LA"], ["Maine", "ME"], ["Maryland", "MD"],
  ["Massachusetts", "MA"], ["Michigan", "MI"], ["Minnesota", "MN"], ["Mississippi", "MS"], ["Missouri", "MO"],
  ["Montana", "MT"], ["Nebraska", "NE"], ["Nevada", "NV"], ["New Hampshire", "NH"], ["New Jersey", "NJ"],
  ["New Mexico", "NM"], ["New York", "NY"], ["North Carolina", "NC"], ["North Dakota", "ND"], ["Ohio", "OH"],
  ["Oklahoma", "OK"], ["Oregon", "OR"], ["Pennsylvania", "PA"], ["Rhode Island", "RI"], ["South Carolina", "SC"],
  ["South Dakota", "SD"], ["Tennessee", "TN"], ["Texas", "TX"], ["Utah", "UT"], ["Vermont", "VT"],
  ["Virginia", "VA"], ["Washington", "WA"], ["West Virginia", "WV"], ["Wisconsin", "WI"], ["Wyoming", "WY"],
  ["District of Columbia", "DC"],
  // Territories: not states, but a sincere guess on a state list.
  ["Puerto Rico", "PR"], ["Guam", "GU"], ["U.S. Virgin Islands", "VI"], ["American Samoa", "AS"],
  ["Northern Mariana Islands", "MP"],
];

/**
 * USPS codes of the 50 states and DC, by name. build.ts gives them to state entries as aliases; the matcher takes
 * an all-caps code only exactly, never as a fuzzy match, so "NV" can't catch a typo.
 */
export const US_STATE_CODES: [string, string][] = US_STATES.slice(0, 51);

/**
 * The states, provinces and territories of the countries a one-country list of places covers, as the lists' source
 * tables name them: on such a list a fact says which one the place is in (scripts/validate.ts, Topic `placesIn`).
 * China's table gives "municipality" for the four cities that are provinces of their own (Beijing, Shanghai,
 * Tianjin, Chongqing). Diacritics don't matter ("Goias" is Goiás).
 */
export const DIVISIONS = {
  "United States": US_STATES.map(([name]) => name),
  Canada: [
    "Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Newfoundland",
    "Labrador", "Nova Scotia", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Northwest Territories",
    "Nunavut", "Yukon",
  ],
  Brazil: [
    "Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal", "Federal District", "Espírito Santo",
    "Goiás", "Maranhão", "Mato Grosso", "Mato Grosso do Sul", "Minas Gerais", "Pará", "Paraíba", "Paraná", "Pernambuco",
    "Piauí", "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia", "Roraima", "Santa Catarina",
    "São Paulo", "Sergipe", "Tocantins",
  ],
  India: [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
    "Uttar Pradesh", "Uttarakhand", "West Bengal",
    // Union territories.
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
    "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
  ],
  China: [
    "Anhui", "Fujian", "Gansu", "Guangdong", "Guizhou", "Hainan", "Hebei", "Heilongjiang", "Henan", "Hubei", "Hunan",
    "Jiangsu", "Jiangxi", "Jilin", "Liaoning", "Qinghai", "Shaanxi", "Shandong", "Shanxi", "Sichuan", "Yunnan",
    "Zhejiang", "Guangxi", "Inner Mongolia", "Ningxia", "Tibet", "Xinjiang", "Beijing", "Chongqing", "Shanghai",
    "Tianjin", "Hong Kong", "Macau", "municipality",
  ],
} satisfies Record<string, string[]>;

export type DivisionCountry = keyof typeof DIVISIONS;

/** The 50 states, DC and the inhabited territories (postal codes are added by build.ts, see US_STATE_CODES). */
export function usStates(): Place[] {
  return US_STATES.map(([name]) => ({
    name,
    aliases: name === "District of Columbia" ? ["Washington, D.C.", "Washington DC", "DC", "D.C."] : [],
  }));
}

/** Current franchises; the nickname is an alias ("Celtics"). */
const TEAMS: Record<"nba" | "nfl" | "mlb" | "nhl", string[]> = {
  nba: [
    "Atlanta Hawks", "Boston Celtics", "Brooklyn Nets", "Charlotte Hornets", "Chicago Bulls", "Cleveland Cavaliers",
    "Dallas Mavericks", "Denver Nuggets", "Detroit Pistons", "Golden State Warriors", "Houston Rockets",
    "Indiana Pacers", "Los Angeles Clippers", "Los Angeles Lakers", "Memphis Grizzlies", "Miami Heat",
    "Milwaukee Bucks", "Minnesota Timberwolves", "New Orleans Pelicans", "New York Knicks",
    "Oklahoma City Thunder", "Orlando Magic", "Philadelphia 76ers", "Phoenix Suns", "Portland Trail Blazers",
    "Sacramento Kings", "San Antonio Spurs", "Toronto Raptors", "Utah Jazz", "Washington Wizards",
  ],
  nfl: [
    "Arizona Cardinals", "Atlanta Falcons", "Baltimore Ravens", "Buffalo Bills", "Carolina Panthers",
    "Chicago Bears", "Cincinnati Bengals", "Cleveland Browns", "Dallas Cowboys", "Denver Broncos",
    "Detroit Lions", "Green Bay Packers", "Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars",
    "Kansas City Chiefs", "Las Vegas Raiders", "Los Angeles Chargers", "Los Angeles Rams", "Miami Dolphins",
    "Minnesota Vikings", "New England Patriots", "New Orleans Saints", "New York Giants", "New York Jets",
    "Philadelphia Eagles", "Pittsburgh Steelers", "San Francisco 49ers", "Seattle Seahawks",
    "Tampa Bay Buccaneers", "Tennessee Titans", "Washington Commanders",
  ],
  mlb: [
    "Arizona Diamondbacks", "Athletics", "Atlanta Braves", "Baltimore Orioles", "Boston Red Sox", "Chicago Cubs",
    "Chicago White Sox", "Cincinnati Reds", "Cleveland Guardians", "Colorado Rockies", "Detroit Tigers",
    "Houston Astros", "Kansas City Royals", "Los Angeles Angels", "Los Angeles Dodgers", "Miami Marlins",
    "Milwaukee Brewers", "Minnesota Twins", "New York Mets", "New York Yankees", "Philadelphia Phillies",
    "Pittsburgh Pirates", "San Diego Padres", "San Francisco Giants", "Seattle Mariners", "St. Louis Cardinals",
    "Tampa Bay Rays", "Texas Rangers", "Toronto Blue Jays", "Washington Nationals",
  ],
  nhl: [
    "Anaheim Ducks", "Boston Bruins", "Buffalo Sabres", "Calgary Flames", "Carolina Hurricanes",
    "Chicago Blackhawks", "Colorado Avalanche", "Columbus Blue Jackets", "Dallas Stars", "Detroit Red Wings",
    "Edmonton Oilers", "Florida Panthers", "Los Angeles Kings", "Minnesota Wild", "Montreal Canadiens",
    "Nashville Predators", "New Jersey Devils", "New York Islanders", "New York Rangers", "Ottawa Senators",
    "Philadelphia Flyers", "Pittsburgh Penguins", "San Jose Sharks", "Seattle Kraken", "St. Louis Blues",
    "Tampa Bay Lightning", "Toronto Maple Leafs", "Utah Mammoth", "Vancouver Canucks", "Vegas Golden Knights",
    "Washington Capitals", "Winnipeg Jets",
  ],
};

const MULTI_WORD_NICKNAMES = /\b(Red Sox|White Sox|Blue Jays|Trail Blazers|Maple Leafs|Red Wings|Blue Jackets|Golden Knights)$/;

/**
 * Other current names fans write besides the nickname (no plain words: "cards" and "halos" are left out): short
 * forms, and a city's initials where fans use them. validate.ts fails a team list that lacks one.
 */
const TEAM_SHORT: Record<string, string[]> = {
  "Arizona Diamondbacks": ["D-backs", "Dbacks"],
  "Washington Nationals": ["Nats", "Washington Nats"],
  "Philadelphia Phillies": ["Phils"],
  "Toronto Blue Jays": ["Jays"],
  "Jacksonville Jaguars": ["Jags"],
  // The A's dropped "Oakland" in 2025: fans name them by their home now (Sacramento) or from 2028 (Las Vegas).
  // "sacramento athletics" was "Not one of the 30 MLB teams" (player report).
  Athletics: ["A's", "Sacramento Athletics", "Sacramento A's", "Las Vegas Athletics", "Las Vegas A's", "Oakland Athletics", "Oakland A's"],
  "Los Angeles Angels": ["LA Angels"],
  "Los Angeles Dodgers": ["LA Dodgers"],
  "New York Mets": ["NY Mets"],
  "New York Yankees": ["NY Yankees"],
  "San Francisco Giants": ["SF Giants"],
  "San Diego Padres": ["SD Padres"],
  "Kansas City Royals": ["KC Royals"],
  // "tb rays", "chi sox", "la rams", "ny jets", "sf niners" found nothing (coverage audit, Nov 8).
  "Tampa Bay Rays": ["TB Rays"],
  "Chicago White Sox": ["Chi Sox", "ChiSox"],
  "Los Angeles Rams": ["LA Rams"],
  "Los Angeles Chargers": ["LA Chargers"],
  "New York Jets": ["NY Jets"],
  "New York Giants": ["NY Giants"],
  "San Francisco 49ers": ["SF 49ers", "SF Niners"],
  "Tampa Bay Buccaneers": ["TB Bucs"],
  "Green Bay Packers": ["GB Packers"],
  "New England Patriots": ["NE Patriots"],
  "Las Vegas Raiders": ["LV Raiders"],
  "Kansas City Chiefs": ["KC Chiefs"],
};

function teams(league: keyof typeof TEAMS): Place[] {
  return TEAMS[league].map((name) => {
    const nickname = name.match(MULTI_WORD_NICKNAMES)?.[1] ?? name.split(" ").at(-1)!;
    return { name, aliases: [...(nickname === name ? [] : [nickname]), ...(TEAM_SHORT[name] ?? [])] };
  });
}

export const UNIVERSES = {
  countries,
  capitals: capitalPlaces,
  "us-states": usStates,
  "nba-teams": () => teams("nba"),
  "nfl-teams": () => teams("nfl"),
  "mlb-teams": () => teams("mlb"),
  "nhl-teams": () => teams("nhl"),
} satisfies Record<string, () => Place[]>;

export type Universe = keyof typeof UNIVERSES;
