// Which unranked answers (rank 0) get a value from their article's infobox: the ones a normal player is most
// likely to type. A miss on a famous peak should say "Matterhorn: 4,478 m", not just "not in the top 10".
//
// Picked per topic, at most LIKELY_CAP, in tiers:
//   1. named in LIKELY below and listed in the topic's Wikipedia Vital articles section;
//   2. named in LIKELY only;  3. in the Vital articles section only.
// The tier that crosses the cap is ordered by the article's page views in the past 30 days (its info page).
// A topic with no more than LIKELY_CAP unranked answers takes all of them.
// Names not in the topic's pool are ignored. The build records what it picked in scripts/unranked/<id>.json.
import type { Entry } from "../src/game/types";
import { normalize } from "../src/game/match";
import { fetchPage, fetchPageViews } from "./wiki";

export const LIKELY_CAP = 100;

/** A Vital articles page and the headings whose sections (with their subsections) are read. */
interface VitalSection {
  page: string;
  heading: RegExp;
}

const VITAL_ROOT = "Wikipedia:Vital articles/Level 5/";

export const VITAL: Record<string, VitalSection[]> = {
  mountains: [{ page: VITAL_ROOT + "Geography/Physical", heading: /^mountain peaks|volcano/i }],
  islands: [{ page: VITAL_ROOT + "Geography/Physical", heading: /^islands\b/i }],
  "nba-points": [{ page: VITAL_ROOT + "People/Sports figures", heading: /basketball/i }],
  "youtube-channels": [
    { page: VITAL_ROOT + "People/Entertainers, directors, producers, and screenwriters", heading: /web entertainers|internet/i },
  ],
  airports: [{ page: VITAL_ROOT + "Technology/Transportation", heading: /^airports$/i }],
};

/**
 * Picks whose infobox number reads cleanly but means something else, found in review: entry name → reason.
 * They stay picked (and recorded) but get no value.
 */
export const NO_VALUE: Record<string, Record<string, string>> = {
  islands: {
    "British Indian Ocean Territory": "infobox area (54,400 km²) is mostly sea; the islands' land is about 60 km²",
  },
};

/**
 * Picks whose infobox lacks the number although the article states it, found in review: entry name → the value
 * in the list's unit, with where it comes from. Used instead of reading the infobox.
 */
export const FIXED_VALUE: Record<string, Record<string, { display: string; number: number; source: string }>> = {
  mountains: {
    // The cached article's infobox has no Elevation row; its lead gives "a summit elevation of 3,776.24 m".
    "Mount Fuji": { display: "3,776", number: 3776, source: "article lead, summit elevation of 3,776.24 m" },
  },
};

/**
 * What a normal person would type, roughly most famous first. Ranked entries are ignored, so these lists can
 * name things that happen to be in the top 100 today. Spelling follows Wikipedia titles; aliases also match.
 */
export const LIKELY: Record<string, string[]> = {
  mountains: [
    "Matterhorn", "Mont Blanc", "Mount Fuji", "Mount Kilimanjaro", "Denali", "Mount Elbrus", "Aconcagua",
    "Mount Kosciuszko", "Vinson Massif", "Puncak Jaya", "Mount Rainier", "Mount St. Helens", "Mount Whitney",
    "Mount Olympus", "Ben Nevis", "Mount Etna", "Mount Vesuvius", "Mount Ararat", "Mount Kenya", "Aoraki / Mount Cook",
    "Eiger", "Jungfrau", "Mönch", "Monte Rosa", "Dufourspitze", "Zugspitze", "Grossglockner", "Weisshorn",
    "Grandes Jorasses", "Gran Paradiso", "Piz Bernina", "Barre des Écrins", "Aiguille du Midi", "Aiguille Verte",
    "Dent Blanche", "Grand Combin", "Finsteraarhorn", "Dom (mountain)", "Lyskamm", "Ortler", "Triglav", "Monte Viso",
    "Marmolada", "Tre Cime di Lavaredo", "Piz Badile", "Petit Dru", "Pilatus (mountain)", "Rigi", "Titlis", "Säntis",
    "Dachstein", "Watzmann", "Wildspitze", "Mont Blanc du Tacul", "Mont Maudit", "Dent d'Hérens", "Täschhorn",
    "Nadelhorn", "Breithorn", "Allalinhorn", "Strahlhorn", "Bietschhorn", "Schreckhorn", "Aletschhorn",
    "Mount Logan", "Pico de Orizaba", "Popocatépetl", "Iztaccíhuatl", "Chimborazo", "Cotopaxi", "Ojos del Salado",
    "Huascarán", "Illimani", "Mount Erebus", "Mount Kinabalu", "Mount Damavand", "Mount Kazbek", "Mount Kailash",
    "Ama Dablam", "Machapuchare", "Pumori", "Island Peak", "Mount Meru (Tanzania)", "Mount Stanley",
    "Mount Ruapehu", "Mount Taranaki", "Mount Cook", "Mount Hood", "Mount Shasta", "Pikes Peak", "Mount Washington",
    "Mount Sinai", "Table Mountain", "Mount Pinatubo", "Mayon", "Krakatoa", "Mount Tambora", "Mount Merapi",
    "Mount Bromo", "Mount Rinjani", "Mount Agung", "Sakurajima", "Mount Asama", "Mount Ontake", "Mount Unzen",
    "Mount Aso", "Mount Bandai", "Mount Iwate", "Mount Chōkai", "Mount Yōtei", "Mount Zaō", "Mount Hakusan",
    "Mount Norikura", "Mount Myōkō", "Mount Nasu", "Mount Tokachi", "Mount Kaimon", "Mount Tate", "Mount Yari",
    "Mount Hotaka", "Mount Haku", "Snowdon", "Mount Teide", "Teide", "Mount Athos",
  ],
  islands: [
    "Hawaiian Islands", "Canary Islands", "Galápagos Islands", "Faroe Islands", "Channel Islands", "Balearic Islands",
    "Azores", "Madeira", "Maldives", "Seychelles", "The Bahamas", "Bahamas", "Fiji", "Philippines", "Japan",
    "Indonesia", "New Zealand", "Solomon Islands", "Marshall Islands", "Cook Islands", "Falkland Islands",
    "Aleutian Islands", "Florida Keys", "Hebrides", "Outer Hebrides", "Inner Hebrides", "Orkney", "Shetland",
    "Isles of Scilly", "Svalbard", "Franz Josef Land", "Novaya Zemlya", "Kuril Islands", "Ryukyu Islands",
    "Andaman Islands", "Nicobar Islands", "Andaman and Nicobar Islands", "Lakshadweep", "Maluku Islands",
    "Spratly Islands", "Cyclades", "Dodecanese", "Ionian Islands", "Aegean Islands", "Sporades", "Aeolian Islands",
    "Frisian Islands", "Åland", "Åland Islands", "Lofoten", "Vesterålen", "Malta", "Singapore", "Bahrain",
    "Mauritius", "Comoros", "Cape Verde", "São Tomé and Príncipe", "Zanzibar Archipelago", "Tonga", "Samoa",
    "Tuvalu", "Kiribati", "Nauru", "Palau", "Federated States of Micronesia", "Micronesia", "Vanuatu",
    "French Polynesia", "Society Islands", "Marquesas Islands", "Easter Island", "Bermuda", "Cayman Islands",
    "Turks and Caicos Islands", "Virgin Islands", "British Virgin Islands", "United States Virgin Islands",
    "U.S. Virgin Islands", "Antigua and Barbuda", "Saint Kitts and Nevis", "Trinidad and Tobago", "Grenada",
    "Barbados", "Saint Lucia", "Dominica", "Saint Vincent and the Grenadines", "Greater Antilles", "Lesser Antilles",
    "West Indies", "Antilles", "Leeward Islands", "Windward Islands", "ABC islands", "Greater Sunda Islands",
    "Lesser Sunda Islands", "Sunda Islands", "Thousand Islands", "San Juan Islands", "Channel Islands (California)",
    "Gulf Islands", "Queen Elizabeth Islands", "Canadian Arctic Archipelago", "Pitcairn Islands", "Tristan da Cunha",
    "Saint Helena", "South Georgia and the South Sandwich Islands", "Kerguelen Islands", "Chatham Islands",
    "Torres Strait Islands", "Bismarck Archipelago", "Mariana Islands", "Northern Mariana Islands", "Guam",
    "Caroline Islands", "Gilbert Islands", "Tokelau", "Wallis and Futuna", "New Caledonia", "Norfolk Island",
    "Christmas Island", "Cocos (Keeling) Islands", "Isle of Man", "Jersey", "Guernsey", "Gibraltar", "Cyprus",
    "Sri Lanka", "Taiwan", "Jamaica", "Cuba", "Haiti", "Dominican Republic", "Puerto Rico", "Iceland", "Ireland",
    "United Kingdom", "Greenland", "Madagascar",
  ],
  "nba-points": [
    "Magic Johnson", "Julius Erving", "Yao Ming", "Dennis Rodman", "Scottie Pippen", "Bill Russell", "Steve Nash",
    "Jason Kidd", "John Stockton", "Isiah Thomas", "Tracy McGrady", "Klay Thompson", "Draymond Green",
    "Kawhi Leonard", "Nikola Jokić", "Luka Dončić", "Joel Embiid", "Anthony Davis", "Jimmy Butler", "Paul George",
    "Blake Griffin", "Chris Bosh", "Tony Parker", "Manu Ginóbili", "Derrick Rose", "Zion Williamson", "Ja Morant",
    "Jayson Tatum", "Devin Booker", "Ben Simmons", "Trae Young", "Victor Wembanyama", "LaMelo Ball", "Bill Walton",
    "Bob Cousy", "George Mikan", "Pete Maravich", "Kevin McHale", "Dikembe Mutombo", "Alonzo Mourning",
    "Grant Hill", "Penny Hardaway", "Shawn Kemp", "Chris Webber", "Rasheed Wallace", "Ben Wallace", "Jeremy Lin",
    "Manute Bol", "Muggsy Bogues", "Spud Webb", "Steve Kerr", "Dwight Howard", "Rajon Rondo", "Amar'e Stoudemire",
    "Tim Hardaway", "Gilbert Arenas", "Brandon Roy", "Kemba Walker", "Kevin Love", "DeMarcus Cousins",
    "Rudy Gobert", "Bam Adebayo", "Domantas Sabonis", "Tyrese Haliburton", "Shai Gilgeous-Alexander",
    "Anthony Edwards", "Donovan Mitchell", "Kristaps Porziņģis", "Karl-Anthony Towns", "Zach LaVine",
    "Bradley Beal", "Jaylen Brown", "Pascal Siakam", "Kyrie Irving", "Giannis Antetokounmpo", "Damian Lillard",
    "Chris Paul", "Dwyane Wade", "Allen Iverson", "David Robinson", "Pau Gasol", "Vince Carter", "Kevin Garnett",
    "Tim Duncan", "Charles Barkley", "Patrick Ewing", "Reggie Miller", "Ray Allen", "Paul Pierce", "Gary Payton",
    "Wes Unseld", "Willis Reed", "Walt Frazier", "Dave Cowens", "Nate Archibald", "Earl Monroe", "Rick Barry",
    "Bob Pettit", "Dolph Schayes", "Jerry Lucas", "Nate Thurmond", "Artis Gilmore", "Bernard King", "Mark Price",
    "Joe Dumars", "Chris Mullin", "Mitch Richmond", "James Worthy", "Kevin Johnson", "Larry Johnson",
    "Glen Rice", "Jamal Mashburn", "Baron Davis", "Steve Francis", "Jalen Brunson", "Cade Cunningham",
    "Paolo Banchero", "Tyrese Maxey", "De'Aaron Fox", "Jamal Murray", "Andre Iguodala", "Lamar Odom",
    "Ron Artest", "Metta World Peace", "Robert Horry", "Derek Fisher", "Shane Battier", "Kyle Lowry",
    "Al Horford", "Deron Williams", "Andrei Kirilenko", "Peja Stojaković", "Hedo Türkoğlu", "Toni Kukoč",
    "Arvydas Sabonis", "Dražen Petrović", "Vlade Divac", "Detlef Schrempf", "Šarūnas Marčiulionis",
  ],
  "youtube-channels": [
    "Smosh", "PewDiePie", "Markiplier", "Jacksepticeye", "KSI", "Logan Paul", "Jake Paul", "Ninja (gamer)",
    "Shane Dawson", "Jenna Marbles", "Casey Neistat", "Philip DeFranco", "Ray William Johnson", "Nigahiga",
    "Lilly Singh", "Zoella", "Joe Sugg", "Dan and Phil", "Dan Howell", "Phil Lester", "Tyler Oakley", "Mark Rober",
    "Veritasium", "Vsauce", "Kurzgesagt", "CGP Grey", "Linus Tech Tips", "Marques Brownlee", "Unbox Therapy",
    "iJustine", "Good Mythical Morning", "Rhett & Link", "The Game Theorists", "MatPat", "Jeffree Star",
    "James Charles", "Tana Mongeau", "David Dobrik", "Emma Chamberlain", "Liza Koshy", "Lele Pons", "Hank Green",
    "Vlogbrothers", "CrashCourse", "TheOdd1sOut", "Jaiden Animations", "Dream (YouTuber)", "GeorgeNotFound",
    "TommyInnit", "Technoblade", "DanTDM", "Stampy", "CaptainSparklez", "VanossGaming", "H2O Delirious",
    "Sidemen", "Beta Squad", "Miniminter", "Vikkstar123", "W2S", "Zerkaa", "TBJZL", "Behzinga", "Danny Gonzalez",
    "Drew Gooden", "Kurtis Conner", "Cody Ko", "Noel Miller", "H3h3Productions", "Ethan Klein", "Ali-A",
    "Typical Gamer", "Preston (YouTuber)", "Unspeakable", "SSSniperWolf", "Brent Rivera", "Hasan Piker", "XQc",
    "Pokimane", "Valkyrae", "Sykkuno", "Corpse Husband", "Ludwig Ahgren", "Kai Cenat", "IShowSpeed", "Dhar Mann",
    "Ryan Trahan", "Airrack", "Yes Theory", "ChrisFix", "Ms Rachel", "Blippi", "Ryan's World", "The Try Guys",
    "Jubilee Media", "Hot Ones", "Binging with Babish", "Nikocado Avocado", "Colleen Ballinger", "Miranda Sings",
    "Grace Helbig", "Hannah Hart", "Michelle Phan", "Bethany Mota", "Rosanna Pansino", "Caspar Lee", "Alfie Deyes",
    "KickThePj", "Charlieissocoollike", "Joe Weller", "JiDion", "MrBeast", "Dude Perfect", "Smosh Games",
    "Epic Rap Battles of History", "Fine Brothers", "React (franchise)", "Annoying Orange", "Fred Figglehorn",
    "Lonelygirl15", "Charlie Bit My Finger", "Jawed Karim", "Me at the zoo", "Mrwhosetheboss", "Tom Scott",
    "Primitive Technology", "Mark Fischbach", "Seán McLoughlin", "Felix Kjellberg", "Jimmy Donaldson",
    "Anthony Padilla", "Ian Hecox", "Dobre Brothers", "FaZe Clan", "Daniel Middleton", "JacksFilms", "Jschlatt",
    "Moist Critikal", "Penguinz0", "Kwebbelkop",
  ],
  // airports: no list; its unranked pool is under LIKELY_CAP, so all of it is taken.
};

export interface Pick {
  entry: Entry;
  why: string;
}

/** Article titles linked under the matching headings of a Vital articles page (subsections included). */
export async function vitalTitles(sections: VitalSection[]): Promise<string[]> {
  const out = new Set<string>();
  for (const { page, heading } of sections) {
    const $ = await fetchPage(page);
    // The page nests each heading's section, subsections included, in a <section>.
    $("#mw-content-text section")
      .filter((_, s) => heading.test($(s).children(".mw-heading").first().find("h2, h3, h4, h5, h6").first().text().trim()))
      .find("a[title]")
      .each((_, a) => {
        const t = $(a).attr("title")!;
        if (/\/wiki\//.test($(a).attr("href") ?? "") && !NAMESPACE.test(t)) out.add(t);
      });
  }
  return [...out];
}

const NAMESPACE = /^(Wikipedia|Template|Help|File|Category|Special|Portal|Module|Draft|User)( talk)?:|^Talk:|-Class article$|^(Featured|Good) article$/;

const bare = (title: string) => normalize(title.replace(/\s*\(.*?\)\s*/g, " "));

/**
 * The unranked entries of a topic most worth a value, with why each was picked. `articleOf` gives an entry's
 * Wikipedia title.
 */
export async function pickLikely(id: string, entries: Entry[], articleOf: (e: Entry) => string): Promise<Pick[]> {
  const pool = entries.filter((e) => e.rank === 0);
  if (pool.length <= LIKELY_CAP) return pool.map((entry) => ({ entry, why: "whole pool" }));

  const vital = new Set<Entry>();
  const titles = await vitalTitles(VITAL[id] ?? []);
  const byTitle = new Set(titles);
  const byBare = new Set(titles.map(bare));
  for (const e of pool) if (byTitle.has(articleOf(e)) || byBare.has(normalize(e.name))) vital.add(e);

  const hand: Entry[] = [];
  const missing: string[] = [];
  for (const name of LIKELY[id] ?? []) {
    const n = normalize(name);
    const nb = bare(name);
    let hits = pool.filter((e) => normalize(e.name) === n || normalize(articleOf(e)) === n);
    if (!hits.length) hits = pool.filter((e) => normalize(e.name) === nb);
    if (!hits.length) {
      const byAlias = pool.filter((e) => e.aliases.some((a) => normalize(a) === n));
      if (byAlias.length === 1) hits = byAlias;
    }
    if (!hits.length) missing.push(name);
    for (const e of hits) if (!hand.includes(e)) hand.push(e);
  }
  if (missing.length) console.log(`     ${id}: ${missing.length} LIKELY names not unranked here (ranked or not in the pool)`);

  const tiers: [string, Entry[]][] = [
    ["vital+likely", hand.filter((e) => vital.has(e))],
    ["likely", hand.filter((e) => !vital.has(e))],
    ["vital", pool.filter((e) => vital.has(e) && !hand.includes(e))],
  ];
  const out: Pick[] = [];
  for (const [why, tier] of tiers) {
    const room = LIKELY_CAP - out.length;
    if (room <= 0) break;
    let chosen = tier;
    if (tier.length > room) {
      const views = new Map<Entry, number>();
      for (const e of tier) views.set(e, (await fetchPageViews(articleOf(e))) ?? 0);
      chosen = [...tier].sort((a, b) => views.get(b)! - views.get(a)!).slice(0, room);
    }
    for (const entry of chosen) out.push({ entry, why });
  }
  return out;
}
