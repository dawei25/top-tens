import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface Place {
  name: string;
  aliases: string[];
}

/** Every country and territory, with its native name. */
export function countries(): Place[] {
  const { countries } = require("countries-list") as {
    countries: Record<string, { name: string; native: string; capital: string }>;
  };
  return Object.values(countries).map((c) => ({
    name: c.name,
    aliases: [c.native].filter((a) => a && a !== c.name),
  }));
}

export function capitals(): string[] {
  const { countries } = require("countries-list") as { countries: Record<string, { capital: string }> };
  return Object.values(countries)
    .map((c) => c.capital)
    .filter(Boolean);
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

/** The 50 states, DC and the inhabited territories. Postal codes are left out: two-letter aliases make every short typo a near match. */
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

function teams(league: keyof typeof TEAMS): Place[] {
  return TEAMS[league].map((name) => {
    const nickname = name.match(MULTI_WORD_NICKNAMES)?.[1] ?? name.split(" ").at(-1)!;
    return { name, aliases: nickname === name ? [] : [nickname] };
  });
}

export const UNIVERSES = {
  countries,
  capitals: () => capitals().map((name) => ({ name, aliases: [] })),
  "us-states": usStates,
  "nba-teams": () => teams("nba"),
  "nfl-teams": () => teams("nfl"),
  "mlb-teams": () => teams("mlb"),
  "nhl-teams": () => teams("nhl"),
} satisfies Record<string, () => Place[]>;

export type Universe = keyof typeof UNIVERSES;
