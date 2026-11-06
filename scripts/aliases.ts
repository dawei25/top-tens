// Alias hygiene: which Wikipedia redirects (and table-derived short forms) are not names a player would type for
// the thing. Used by build.ts when collecting aliases and by validate.ts to flag what slipped through.
//
// Missing aliases are free for the player; a removed real nickname hurts recognition. So every rule here has a
// guard: a word the entry's own names use is never evidence against an alias.
import { createRequire } from "node:module";
import { normalize } from "../src/game/match";

const require = createRequire(import.meta.url);

/** The names an entry is known by: its name, its article title, aliases from its table row. */
export interface AliasContext {
  names: string[];
  /**
   * Other forms of the same thing (redirect titles), used to recognize "Topography of the UK" as being about the
   * United Kingdom. Never used as evidence that an alias is a real name.
   */
  forms?: string[];
  /** A creative work (book, show, film, album, game): redirects that share no word with its names are songs or characters. */
  works?: boolean;
  /** Web addresses are names here (websites, companies): "x.com", "Amazon.com". */
  webNames?: boolean;
}

/** Text without a trailing "(qualifier)": "City (Alaska)" → "City". */
export function baseTitle(title: string): string {
  return title.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

const STOP = new Set("the a an of and in on at to for by with from is it my your you me i we or".split(" "));

/** Normalized words of a name worth comparing: no articles or connectives. */
function words(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}

/** Same word, or one is a misspelling, plural or longer form of the other ("mamma"/"mama", "tetons"/"teton"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // One edit apart.
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const [x, y] = a.length >= b.length ? [a, b] : [b, a];
  return x.slice(i + 1) === y.slice(x.length === y.length ? i + 1 : i);
}

function sharesWord(alias: string, names: string[]): boolean {
  const own = names.flatMap(words);
  return words(alias).some((w) => own.some((o) => sameWord(w, o)));
}

/** "GTA V" for Grand Theft Auto V, "SSBU" for Super Smash Bros. Ultimate: the letters follow the name's initials. */
function isInitialism(alias: string, names: string[]): boolean {
  // "GTAV", "RDRII": a Roman numeral glued to the letters counts as the number.
  const ROMAN_END: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  const a = normalize(alias)
    .replace(/ /g, "")
    .replace(/(?<=[a-z]{2})(viii|vii|vi|iv|ix|iii|ii|i|v|x)$/, (r) => ROMAN_END[r]);
  if (a.length < 2 || a.length > 8 || /\s/.test(alias.trim()) && a.length > 5) return false;
  return names.some((n) => {
    // normalize() drops a leading "The"; an initialism keeps it ("TES V").
    const initials = (/^the\s/i.test(n) ? "t" : "") + normalize(n)
      .split(" ")
      .map((w) => (/^\d+$/.test(w) ? w : w[0]))
      .join("");
    let j = 0;
    for (const c of initials) if (c === a[j]) j++;
    return j === a.length && initials[0] === a[0];
  });
}

/** Parts of a work a redirect can name: "Wonderful (Wicked song)", "Elphaba (character)". */
const WORK_PART = /\b(song|songs|single|character|characters|episode|episodes|chapter|aria|soundtrack|track|number|scene|villain|protagonist)\b/i;

/** Words that make "X of Y" a name of Y rather than an aspect of it: "State of Kuwait", "Republic of the Congo". */
const CLASS_NOUN = new Set(
  (
    "republic kingdom state states commonwealth federation confederation union empire principality emirate sultanate duchy " +
    "province territory dominion realm nation country bailiwick city town village county borough municipality " +
    "prefecture region desert lake mount river sea gulf bay cape peninsula island isle archipelago museum gallery " +
    "tower palace castle cathedral temple church university bank field stadium arena"
  ).split(" "),
);

/** "<aspect> of/in <the thing>": the connecting words. */
const CONNECTOR = /\s(of|in|involving|during|under|for|on|at|against|from|about|by|within|surrounding)\s(the\s)?/gi;

/**
 * Words naming an event, a part, a document or a topic rather than the thing itself: "1937 Nanga Parbat tragedy",
 * "Yellowstone Act", "Southeast ridge", "Makalu Base Camp", "Irish politics". Only evidence when none of the
 * entry's own names uses the word.
 */
const TOPIC_WORDS = new Set(
  (
    "act acts tragedy disaster accident incident expedition expeditions hearing hearings timeline history climate " +
    "archive archives ridge spur route camp campground circuit trek pass byway hole ecosystem wilderness massacre attack " +
    "bombing crash avalanche riot riots protest protests scandal lawsuit lawsuits trial battle campaign election " +
    "referendum economy factsheet slogan mansion department ministry politics origin information symbols heritage " +
    "bibliography infrastructure topography wildfire wildfires establishment foundation fund advisors review " +
    "trends revolution census statistics art band wildlife animals fauna flora " +
    // Places inside a city or a country, and institutions there: "Vancouver Christian School", "Rua das Flores".
    "school schools academy elementary montessori church hotel street road avenue boulevard lane highway highways " +
    "neighbourhood neighbourhoods neighborhood neighborhoods suburb oblast county league association " +
    "terminal hangar murals flight crashes program programme commission board constitution government facilities " +
    // Subtopics and spin-offs: "Pune weather", "Recife cuisine", "Frozen fandom", "Kansas City Chiefs Cheerleaders".
    "weather cuisine food skyline culture nightlife fandom fan fans roster rosters cheerleaders players retired fame " +
    "depth trophies shop podcast festival investigation investigations approval polling policy policies " +
    "administration tax relations demographics map maps strategy mascot anthem motto ranks branches etiquette " +
    "customs geography literature exploration magnetosphere radius mass distance orbit system allegations " +
    "philanthropy collectibles pension lobbying controversy controversies valley basin watershed region"
  ).split(" "),
);
/** Multi-word topic phrases. */
const TOPIC_PHRASES =
  /\b(metropolitan areas?|base camp|fact sheet|cultural influence|science and technology|protected areas?|ring of honou?r|in pop culture)\b/i;

/**
 * Slurs, insults and vandalism among Wikipedia's redirects ("T-gay" to T-Series, "Bramladesh" to Brampton). A
 * rebuild must never bring them back, on any list.
 */
export const BLOCKED_ALIASES = [
  "T-gay", "Bramladesh", "Hong couver", "Hong kouver", "Hongcouver", "New York Shitty", "Sidney Cry baby",
  "Sidney Crybaby", "A-fraud", "America's Wang", "Ayatollah dictatorship", "Microsoft.sucks", "Snovechkin",
  "Barroid", "Elonia Musk", "First Lady Elonia", "First Lady Elonia Musk", "Toddler ceo", "Yankees Suck",
  "Shaqtoberfest", "Triple-double cocaine bear", "Throw Rogan", "RIP Harambe",
];
/** Words that make a redirect an insult, unless the entry's own name has the word (Rudy Gay). */
const INSULT = /\b(gay|fags?|faggots?|retard(ed|s)?|shitty|shit|sucks?|crybaby|cry baby|dumb|idiot|moron|loser|fraud)\b/i;

/** A redirect that is an insult or a slur: never an alias. */
export function blockedAlias(alias: string, names: string[]): boolean {
  const n = normalize(alias);
  if (BLOCKED.has(n)) return true;
  const word = alias.match(INSULT)?.[0];
  return !!word && !names.some((name) => new RegExp(`\\b${word}\\b`, "i").test(name));
}
const BLOCKED = new Set(BLOCKED_ALIASES.map(normalize));

/** A web address: "Dallascowboys.com", "Www.britishmuseum.org", ".bnpparibas". Names on most lists, not on websites. */
export const WEB_ADDRESS = /^(www\.|\.)|\.(com|org|net|gov|edu|co\.uk|io|tv|sucks|info)$/i;

/** A description, not a name: "Highest mountain in Asia", "Largest US state", "First trillionaire". */
const DESCRIPTION = /^(the )?(highest|tallest|largest|biggest|longest|richest|deepest|busiest|oldest|most|first|world's|worlds)\b/i;

/** A year: an event or an edition ("1937 Nanga Parbat tragedy", "Glacier National Park Act of 1914"). */
const YEAR = /\b(1[6-9]\d\d|20\d\d)\b/;

/**
 * Why a redirect title (as Wikipedia has it, qualifier included) is not a name for the entry, or null if it may be.
 */
export function junkRedirect(raw: string, ctx: AliasContext): string | null {
  const base = baseTitle(raw);
  const names = ctx.names.filter(Boolean);
  const own = new Set(names.map(normalize));
  if (own.has(normalize(base))) return null;
  const forms = new Set([...names, ...(ctx.forms ?? []).map(baseTitle)].map(normalize).filter(Boolean));
  const ownWords = new Set(names.flatMap(words));
  const usesOwnWord = (w: string) => [...ownWords].some((o) => sameWord(w, o));

  // "City (Alaska)", "Recording District (Alaska)", "Wonderful (Wicked song)": a part of the thing, named in the qualifier.
  // Only plain words count as a part: "America (United States)" and "Twitter (X)" are names, "City (Alaska)" is not.
  const qualifier = raw.match(/\(([^)]*)\)\s*$/)?.[1];
  if (qualifier && !sharesWord(base, names)) {
    if (WORK_PART.test(qualifier)) return "a song or character";
    const plain = normalize(base).split(" ").every((w) => isEnglishWord(w));
    const named = forms.has(normalize(qualifier)) || own.has(normalize(qualifier));
    if (plain && named && normalize(qualifier).length > 2) return "a part of the thing, not a name for it";
  }

  // "Tale of Two Cities, A", "Musk, Elon": an index sort key.
  const inverted = base.match(/^([^,]+),\s*([^,]+)$/);
  if (inverted && (/^(the|a|an)$/i.test(inverted[2]) || forms.has(normalize(`${inverted[2]} ${inverted[1]}`)))) {
    return "an inverted sort key";
  }

  if (YEAR.test(base) && !names.some((n) => /\d{4}/.test(n))) return "names an event or edition (a year)";

  if (WEB_ADDRESS.test(base) && (!ctx.webNames || /^(www\.|\.)|\.sucks$/i.test(base))) return "a web address";

  // "Kotly, Moscow", "Vista Alegre, Belo Horizonte": a place inside the thing, named before it. "Washington, D.C."
  // and "Atlanta, Georgia" start with the thing's own name and stay.
  // "Apple Computer, Inc." is one name: a company suffix after the comma is no second part.
  const parts = base.replace(/,\s*(inc|ltd|llc|corp|co|plc|sa|ag)\.?$/i, "").split(/\s*,\s*/);
  // "Eminem, Marshall Bruce Mathers III": two of its names joined by a comma, which nobody types.
  if (parts.length === 2 && parts.every((x) => forms.has(normalize(x)))) return "two of its names joined";
  const head = normalize(parts[0]);
  if (parts.length > 1 && !own.has(head) && parts.slice(1).some((p) => forms.has(normalize(p)))) {
    return "a place inside the thing";
  }

  // "Gretzky's Office", "LeBron's son", "Minecraft's cultural impact": something of the thing's, not its name.
  const possessive = base.match(/^(.+?)['’]s\s+(.+)$/);
  if (possessive) {
    const [, whose, what] = possessive;
    const ownWords = names.flatMap((n) => normalize(n).split(" ")).filter((w) => w.length >= 4);
    const isOwn = own.has(normalize(whose)) || ownWords.includes(normalize(whose));
    if (isOwn && !sharesWord(what, names)) return "something of the thing's, not a name for it";
  }

  const first = base.match(DESCRIPTION)?.[2];
  if (first && !usesOwnWord(normalize(first))) return "a description, not a name";

  // "Child abuse in Saudi Arabia", "Law of Iran", "Topography of the UK": about the thing, not a name for it.
  for (const m of base.matchAll(CONNECTOR)) {
    const prefix = base.slice(0, m.index);
    const tail = normalize(base.slice(m.index! + m[0].length));
    if (!prefix || !tail) continue;
    // A name with "of" in it ("The Legend of Zelda") only loses "<x> of <its full name>", never "<x> of <a short form>".
    const fullNames = new Set(names.map(normalize));
    const isAboutIt = names.some((n) => /\s(of|in)\s/i.test(n)) ? fullNames.has(tail) : forms.has(tail);
    if (!isAboutIt) continue;
    // "State of Kuwait", "Saban Field at Bryant–Denny Stadium", "P.R. of China": a name, not an aspect.
    const lastWord = normalize(prefix).split(" ").at(-1) ?? "";
    const abbreviation = /^[A-Z][A-Z.]{0,4}$/.test(prefix.trim().split(/\s+/).at(-1) ?? "");
    if (/^(of|at)$/i.test(m[1]) && (CLASS_NOUN.has(lastWord) || abbreviation)) continue;
    return "about the thing, not a name for it";
  }

  const topic = words(base).find((w) => TOPIC_WORDS.has(w) && !usesOwnWord(w)) ?? base.match(TOPIC_PHRASES)?.[0];
  if (topic && !names.some((n) => normalize(n).includes(normalize(topic)))) return `an event, part or topic ("${topic}")`;

  if (ctx.works && !sharesWord(base, names) && !isInitialism(base, names)) return "shares no word with the work (a song or character?)";
  return null;
}

/**
 * Redirects to country articles that no rule can tell from a name (jokes, people, buildings, events), found by the
 * list judges. Dropped on every list with the countries universe.
 */
/**
 * City redirects that are no way of naming the city, dropped on every city list. The same big cities top every city
 * list (population, visitors, skyscrapers, metro riders), so junk a judge finds on one is junk on all of them.
 */
export const CITY_JUNK = [
  // Rare spellings that only catch typos of ordinary words ("singer" became Xi'an through "Singan", "market" Mecca
  // through "Makkeh").
  "Singan", "Siking", "Signan", "Makkeh", "Shouer", "Singy", "S'pore", "Dtown",
  // Lithuanian for Beijing: "petronas" was offered as Beijing on the skyscraper list.
  "Pekinas",
  // Schools, clubs, parks, buildings, companies, committees, a festival and a fair among the redirects.
  "SJK Lai Meng", "Sekolah Kebangsaan Danau Kota", "Sekolah Jenis Kebangsaan Cina Jalan Davidson", "Rajhans Balvatika",
  "Dadar Catering College", "Clube Náutico da Ilha de Luanda", "Clube Desportivo Nun’Alvares",
  "Clube Desportivo Nun' Alvares", "Falomo garden", "Shenzhen Software Park", "K.L.C.C.", "Citi Hoppa",
  "Chicago Finance Committee", "Chicago Transportation Committee", "Sister Cities Chicago", "Chicago theatre scene",
  "São Paulo International Transport Industry Show", "Accra oil refineries", "Five Grand Palaces of Joseon-Dynasty Seoul",
  "Five Grand Palaces", "Seoul castle town", "Seoul castle", "Joburg.org.za", "Paris.fr", "Wuhan.gov.cn",
  "HUB in a Singapore context", "Sichuanese teahouse",
  // Districts and parts of a city, its history and its people.
  "Fishermen's Village", "Yumin Cun", "West Bund", "Al-Khawaneej", "Littleindia kuala lumpur", "Medan Pasar",
  "Downtown Mumbai", "Western Moscow", "South Seoul", "North Seoul", "Fatehpur beri", "Abdeen", "Iganmu", "Luanda Sul",
  "Deux Plateau", "Rural Abidjan", "Masaki, Tanzania", "Blue Haven, Gauteng", "Higienopolis",
  "Paris, Banks of the Seine", "Paris agglomeration", "Ancient cairo", "Classical cairo", "Cairo in the middle ages",
  "New york immigrants", "Immigration to New York", "Shanghai people", "Kakamuchee", "Galajunkja", "Land of smelly onions",
  "Mumbaikars", "Mumbaikar", "Bombayite", "Eastindians", "Dubaian", "Dubaians", "KLites", "Delhiites", "Dilliwala",
  "Seoulite", "Parisien", "Parisian", "Parisians", "Cairene", "Lagosian", "Kinois", "Kinshasan", "Kinshasans",
  "Léopoldvillian", "Léopoldvillians", "Luandense", "Paulistano", "Paulista", "Beijinger", "Beijingers", "Pekinger",
  "Pekingers", "Peipinger", "Londonise", "Londonize", "London's", "Non ducor, duco",
  // Another place's name: Dili is East Timor's capital.
  "Dili, India", "Delhi, Punjab",
];

/**
 * Redirects to famous people's articles that are relatives, songs, albums, tours, labels, fan names, scandals and
 * companies, found by the list judges. The same stars top the follower, streaming and sales lists, so the list is
 * shared: dropped on every list of people and every follower list (scripts/build.ts).
 */
export const CELEBRITY_JUNK = [
  // Drake, Taylor Swift, Eminem.
  "I Get paper", "Comeback Season II", "It's Never Enough", "Do Right and Kill Everything", "All Kinds", "Fantasy 416",
  "Drake Griffin", "Jungle Tour", "Wanna Know", "Please Forgive Me", "Songs recorded by Drake Canada", "Ela É do Tipo",
  "Frozen Moments", "Nocta", "Sophie Brussaux", "Titles Ruin Everything", "Drake vs. Everybody", "Housekeeping Knows",
  "The Embassy", "OVOXO", "Lost Files", "Gettin' Paid", "Fr8me", "Coffret 4 CD", "3 CD Collector's Set", "Insane",
  "Monologue Song", "Andrea Gardner Swift", "Andrea Swift", "Incredible Things", "Track 5", "Andrea Finlay",
  "Scott Kingsley Swift", "Wonderstruck", "Westbury Road", "Hailie Jade", "Hailie Jade Mathers",
  "Kimberley Anne Scott Mathers", "Hailey Jade", "Hailie Jade Scott", "John Guerrera", "Deborah Mathers", "Debbie mathers",
  "Deborah Mathers-Briggs", "Ronnie Polkingharn", "The Slim Shady Show", "Kim Mathers", "Hailie Mathers",
  "Kimberley Ann Scott Mathers", "Haile Jade Mathers", "Bassmint", "The Way I Am", "Kimberly Anne Scott", "Soul intent",
  "Diss Me, Diss You", "Eight Mile Style", "8 Mile Style", "Kimberly Mathers", "Deborah Nelson Mathers-Briggs",
  "Live at Comerica Park", "Straight from the Vault", "Straight From The Vault EP", "Ken Kaniff", "Hailie Jade Scott Mathers",
  "Lose Yourself Tour", "Evil", "Kimberley Anne Scott", "Shady Ltd.", "Hailie Scott Mathers", "Hailie Scott", "New Jacks",
  "Bassmint Productions", "Debbie Nelson", "Deborah Rae Nelson", "Deborah R. Nelson", "Debbie Rae Nelson",
  "Debbie Mathers-Briggs", "Debbie Nelson-Mathers", "Debbie Rae Mathers", "Slim", "Eminem, Marshall Bruce Mathers III",
  // Beyoncé, Justin Bieber, Michael Jackson, Chris Brown, The Weeknd.
  "Beyoncé Knowles Records and Achivements", "Beyoncé Knowles' music videos", "Beyoncé' music videos",
  "Slow Love World Tour", "Beyoncé Pulse", "The Ultimate Collection", "Pulse", "Third Ward Trill",
  "Rock It Till Water Falls", "Renaissance Trilogy", "Rumi Carter", "Justin Bieber on Twitter", "Skylrk",
  "Jeremy bieber", "Justin Bieber's hair", "Belieber", "Beliebers", "Bieber Mania", "Bieber Fever", "Biebermania",
  "Michael Jackson finances", "Prince Michael Jackson ll", "Grace Rwaramba", "Michael Jackson jr", "Prince Michael Jackson I",
  "Prince Michael Jackson Jr.", "Blanket", "Agent MJ", "Michael Joseph Jackson Jr", "Prince blanket", "MJJ Music",
  "The skinniest Jackson", "The Hee Hee Guy", "Rhinstone Glove", "John Jay Smith", "Johnny Jay Smith", "In the Zone",
  "In My Zone", "Boy in Detention", "Put It Up", "Ghetto Tales", "CBE", "Chris Brown Entertainment",
  "CBE Entertainment", "King Of The Fall", "We're Alone Together", "Starboy", "The Dawn Is Coming", "Kin Kane",
  "Manic Phase", "Bulleez N Nerdz", "Bullies and Nerds", "Gene Hackerman", "Gene.hackerman", "Sober lite",
  // Ariana Grande, Katy Perry, Bruno Mars, Lady Gaga, Shakira.
  "Moonlightbae", "Donutgate", "Ariana Grande credits", "Zandhr", "Dalton Gomez", "Marjorie Grande", "Dolly", "Purr",
  "Meow", "David Hudson", "David Daniel Hudson", "David D. Hudson", "Mad Potion", "Mind's a Maze", "Minds Amaze",
  "Immortal Flame", "Daisy Dove Bloom", "De Soi", "Gypsy Love", "Killa on the Run", "The Hooligans", "Kameron Whalum",
  "Pectoralz", "Los Unidades", "Big Fat Noises", "Little Monsters", "Lady Gaga on Twitter", "Still Have Fun",
  "Shakira ft. Wyclef Jean", "Shakira Bio", "Shakira & Alejandro Sanz", "Shakira notable concerts", "Milan Piqué",
  "Milan Pique", "Pies Descalzos World Tour",
  // Cristiano Ronaldo, Lionel Messi.
  "Kathryn Mayorga", "Cristiano Ronaldo sexual misconduct allegations", "Cristiano Ronaldo Jr.", "Cristiano Ronaldo Junior",
  "Cristiano Ronaldo Júnior", "Cristianinho", "Cristiano Jr.", "Cristiano Ronaldo dos Santos Junior",
  "Cristiano Ronaldo dos Santos Júnior", "Cristiano Ronaldo dos Santos Jr", "UR Cristiano", "UR", "CR", "Ronaldo chop",
  "Striker Force 7", "Thiago Messi", "Messimania",
  // Selena Gomez, the Kardashian-Jenners, Dwayne Johnson.
  "Gracie Elliot Teefey", "Gracie Teefey", "Mandy Teefey", "Brian Teefey", "Ricardo Joel Gomez", "July Moon Productions",
  "I'll Be Single Soon", "The Kylie Jenner Effect", "Stormi Webster", "Kim Kardashian effect", "Kimye", "KKW Beauty",
  "SKKY Partners", "Kim Kardashian Productions", "Good American", "The Rock in Video Games", "Rock The Promo",
  "Lauren Hashian", "The People's Championship",
  // Narendra Modi, Elon Musk, Barack Obama.
  "Hiraben Modi", "Heeraben Modi", "HE Hiraben Modi", "Damodardas Mulchand Modi", "Damodardas Modi", "Mulchand Modi",
  "Narendra Modi's Google+ Hangout", "Use of Technology by Narenda Modi", "NaMo TV", "Founder of SpaceX",
  "Michelle Obama's husband",
  // Athletes (the earnings list and the career lists): fights, relatives, staff, companies, pets and jokes.
  "Canelo Álvarez vs Victor Ortiz", "Will Ireton", "Gloria James", "Bronny's dad", "Bronny James Sr.", "The Bronze Jade",
  "LRMR", "Lebrick", "Lebrick James", "Unanimous Media", "Sentenced", "My Next Chapter", "You the real MVP", "XNDA",
  "XDNA", "Dawn Apollo Films", "Dawn Apollo Studios", "Hamilton and Alonso", "Untitled Lewis Hamilton project",
  "Roscoe Hamilton",
  // Instagram's own account: features, users and studies of the app (on the Instagram and Facebook lists).
  "Instagram Stories", "Instagram story", "Instagram Direct", "Instagram Live", "Effects of Instagram on mental health",
  "Instagram impact on people", "Instagrammer", "Instagram blogger", "Instagram Kids", "Instagram from Facebook", "Ig.me",
  // Brand accounts: FC Barcelona's board members and eras, Netflix's algorithm, studios, spin-offs and fan sites,
  // Samsung's scandals and models (on every follower list, not just the Facebook one).
  "Carles Vilarrubi Carrio", "Johan Cruyff's Dream Team", "FC Barcelona trophies", "Cinematch", "Qwikster", "Quikster",
  "Fast.com", "Magic Quill Productions", "FLIXPAC", "UNoGS", "Unofficial Netflix Online Global Search",
  "Still Watching Netflix", "Netflix machine", "Controversies surrounding Samsung", "Democratic People's Republic of Samsung",
  "Republic of Samsung", "Samsung Wave M", "SAMSUNG WB750", "ES70",
];

/**
 * Redirects to company articles that are slogans, subsidiaries, sites, people, products, lawsuits and offices, found
 * by the list judges and the leak audit. Dropped on every list where web addresses are names (companies, websites),
 * so a fix on one company list holds on the others: "bookworm" found Amazon through "Bookworm.com" on one list after
 * it was dropped on another.
 */
export const COMPANY_JUNK = [
  // Amazon: sites it bought or redirects, which only catch typos of ordinary words ("bookworm", "relentless").
  "Bookworm.com", "Relentless.com", "Unboxed.com", "Soundunwound.com", "Soundunwound", "Sound unwound", "BeautyBar.com",
  "Wag.com", "Yoyo.com", "AfterSchool.com", "Casa.com", "Myhabit.com", "Look.com", "Junglee", "Junglee.com",
  "Indigo Starfish", "Lobbying by Amazon", "Lobbying by Amazon.com", "Controversies surrounding Amazon, Inc.",
  "Amazon leadership principles", "Commingled inventory", "Co-mingled inventory", "Comingled inventory", "AStore",
  "Katherine L. Adams", "Directly Responsible Individual",
  // Apple, Microsoft, Nvidia, Meta, SpaceX, TSMC, Symantec, HP.
  "Boycott Apple", "Apple tax", "Apple tax practices", "Tax avoidance by Apple Inc.", "Spruce Technologies", "Raycer",
  "Blibbet", "Lift London", ".bing", "Extended Security Updates", "Microsoft.sucks", "WebsiteSpark", "Officelive.com",
  "Forceware", "IReady", "Controversies surrounding Nvidia", "Project GROOT", "Project Groot", "Nvidia Grace",
  "Project GR00T", "NVIDIA Project GR00T", "NVIDIA GR00T", "Nvidia GROOT", "Generalist Robot 00 Technology",
  "Move fast and break things", "Hacker Way", "1 Hacker Way", "One Hacker Way", "Mars Oasis", "SpaceX Hawthorne facility",
  "SpaceX headquarters", "SpaceX Hawthorne", "Spacex.com", "WaferTech", "TSMC Washington", "Afterburner", "SpeedBooster",
  "125 High Speed Mode", "125HSM", "Symantec Security", "Symantec Security Response", "HP Associates",
  // Walmart, Nike, Saudi Aramco, UnitedHealth, Berkshire Hathaway, PetroChina, ICBC, Bank of America, Sega.
  "Supercenter", "Discount City", "Save Money. Live Better.", "Always Low Prices, Always", "GamePlay", "Just Do It Award",
  "Carbon emissions by Saudi Aramco", "Tim Noel", "Controversies surrounding UnitedHealth Group", "Logistics Health Incorporated",
  "Woodstock for Capitalists", "Berkshire Hathaway Annual Shareholders Meeting", "Xinjiang Oilfield Company",
  "Xinjiang Oil Company", "Great Wall Drilling", "Great Wall Drilling Company", "ICBC.com.cn", "ICBC Leasing",
  "The Bank of East Asia", "Erica", "Sonic",
  // " Inc." (Apple's logo) reads as "inc".
  "Inc.",
];

export const COUNTRY_JUNK = [
  "Science in Aotearoa", "Snow Mexico", "Finnishness", "The Land of Chocolate", "Day of the Capital", "Abdullah al-Saleh", "Al Rawda Palace",
  "Ugandan nationalism", "Ker Alur", "Official language of Southern Sudan", "North Kenya", "Kenya-Africa",
  "Belgian Ubanghi", "Độc lập, tự do, hạnh phúc", "Doc lap, tu do, hanh phuc", "Swedish sin", "Folkland",
  "Federal state", "German infrastructure", "Law and criminal justice of Italy", "Administrative units of Italy",
  "Mountains of Spain", "Bibliography of Finland", "Irish politics", "Ireland politics", "Politic in eire",
  "Politic of eire", "Science and technology in Malta", "Maltese art", "Swedish origin", "Law of Greece",
  "Languages of Saudi Arabia", "Argentina Information", "National symbols of Chile", "Cultural heritage of Chile",
  "Third Republic", "Languages of Vietnam", "Social problems in Saudi Arabia", "Child abuse in Saudi Arabia",
  "National parks in Kuwait", "Water supply and sanitation in Kuwait", "Water resources of Kuwait",
  "Languages of Kuwait", "Law of Iran", "Science and technology in Bahrain",
  "Description of Democratic Republic of Congo", "Project Meridian", "United States military ranks",
  "US military branches", "Customs and etiquette in the services", "Prince Pickles", "Russian Foreign Legion",
  "Muscovian army", "Britain's languages", "Great Britain's languages", "Council Union", "Soviet order",
  "People's republic of russia", "United states of soviet russia", "European USSR", "De", "Modern day China",
  "France–Monaco border", "Monaco–France border", "Fort-Hercule", "Monegasque culture", "Monegasque geography",
  "HUB in a Singapore context", "Gibraltar Health Authority", "Gibraltar Group Practice Medical Scheme",
  "Vatican City culture", "Vatican City cuisine", "Vatican citizenship", "Roman Catholicism in Rome",
  "St. Joseph's Fountain", "Fushifarurah", "Iru fushi", "Irufushi", "See United Kingdom.", "See China.",
  "Topography of the UK", "Topography of the United Kingdom", "Abegistan", "Yananistan", "Land of the Swiss",
  // Rare names that only catch typos of other words ("airplanes" became Ireland, "nunavut" Greenland).
  "Airlann", "Airlan", "Nunaat", "Antarctica of The North", "S'pore", "Pinas", "Sovjet", "Grease", "Island", "Port",
  "Poccnr", "Poccия",
  // Foreign names that "islands" was corrected to (Ireland), and political-topic redirects.
  "Irland", "Irlanda", "Irlandia", "Irland politic", "Political irland", "Irland political",
  // Found by the list judges in cycle 1: a company, a book catalogue, a prefix, regions, social topics, forces.
  "Topstrasse Global", "Bókatíðindi", "Bokatidindi", "Fenno-", "Northern Finland", "Norwegian coastline",
  "Iran consumption expenditure", "Nigerian sport", "Indian society", "Indian social structure",
  "Traditional Indian social structure", "Indian traditional social structure", "India etymology", "Bharath Niwas",
  "Alpine Deutschen", "Iraqi Security Forces", "Iraqi Security Force", "Confucian Southeast Asia", "Roman New Republic",
  "Land of the Irish", "Land of the English",
];

let english: Set<string> | undefined;

/** Lowercase English words (a dictionary list). */
export function isEnglishWord(word: string): boolean {
  english ??= new Set((require("an-array-of-english-words") as string[]).map((w) => w.toLowerCase()));
  return english.has(word.toLowerCase());
}

/**
 * A one-word short form that means something else on its own: "Salt" from Salt Lake Stadium, "Australia" from
 * Stadium Australia, "South" from South Island. `places` are country and state names. Short words (3 letters or
 * fewer) stay: the matcher only finds a word of a longer name from 4 letters up, so they would be lost entirely.
 */
export function bareWord(alias: string, places: Set<string>): boolean {
  const n = normalize(alias);
  if (!n || n.includes(" ") || n.length <= 3) return false;
  return isEnglishWord(n) || places.has(n);
}

/**
 * Alias text glued from several names without spaces: "Mount EverestSagarmathaChomolungma" is the entry's name
 * with another of its names straight after it, no space between.
 */
export function gluedAlias(alias: string, forms: string[]): boolean {
  const others = forms.filter((f) => f !== alias && f.length >= 3);
  // "LeBronJames" is a handle: one name written without its space.
  const compact = (s: string) => normalize(s).replace(/ /g, "");
  if (others.some((f) => compact(f) === compact(alias))) return false;
  return others.some((f) => {
    if (!alias.startsWith(f) || !/[\p{L}\d]$/u.test(f)) return false;
    const rest = alias.slice(f.length);
    return /^\p{Lu}/u.test(rest) && forms.some((g) => g !== f && g !== alias && g.length >= 2 && rest.startsWith(g));
  });
}

/** Single-byte code pages text is written in and read back in by mistake: Western, Central European, Baltic. */
const CODE_PAGES = ["windows-1252", "windows-1250", "windows-1257"];
const decodeByte = (page: string, byte: number) => new TextDecoder(page).decode(Uint8Array.of(byte));

/**
 * For a letter as one code page shows a byte, the letters the others write with that byte, where the matcher sees a
 * different letter: "č" (1250, read as c) → "è" (1252, read as e). Letters it doesn't read as one plain letter (Æ, ø,
 * Ł) are left out: "Æthiopia" and "Jørgensen" are real names, and no swap of theirs is evidence of anything.
 */
const MISREAD = new Map<string, Set<string>>();
const seenAs = (c: string) => (/^[a-z]$/.test(normalize(c)) ? normalize(c) : undefined);
for (let b = 0x80; b <= 0xff; b++) {
  const chars = CODE_PAGES.map((p) => decodeByte(p, b)).filter((c) => seenAs(c));
  for (const shown of chars) {
    for (const meant of chars) {
      if (seenAs(shown) === seenAs(meant)) continue;
      if (!MISREAD.has(shown)) MISREAD.set(shown, new Set());
      MISREAD.get(shown)!.add(meant);
    }
  }
}

/** Windows-1252's byte for each character it shows, to read UTF-8 that was shown as Windows-1252 back ("CÃ©zanne"). */
const CP1252_BYTE = new Map(Array.from({ length: 256 }, (_, b) => [decodeByte("windows-1252", b), b] as const));
/** Splits a name into its words, apostrophes kept ("O'Keeffe"). */
const LETTER_RUNS = /[^\p{L}\p{M}'’]+/u;
/** A word with a letter another code page writes with the same byte as some other letter. */
const misread = (word: string) => [...word].some((c) => MISREAD.has(c));

/**
 * Why a name reads as text decoded in the wrong code page, or null if it reads fine: "Eugčne Henri Paul Gauguin" is
 * Eugène written in Windows-1252 and read as Windows-1250 (a redirect on Paul Gauguin); "CÃ©zanne" is UTF-8 read as
 * Windows-1252; "�" is a character lost on the way.
 *
 * A letter is misread when its word is no word of the thing's and becomes one read in another code page: a word of
 * the entry's other `forms` ("Eugene Henri Paul Gauguin"). Only the thing's own names count as that evidence: any
 * dictionary has some word one swap from a real name ("João" read as "Joćo" is the Scots "joco", "Ilić" as "Iliã"
 * the plural of ilium). The word as written is real if `known` says so (English, another answer's name) or a form
 * spells it without such letters, so two redirects sharing "Eugčne" don't vouch for each other. Real letters of
 * Czech, Polish or Latvian names ("Markuss Rotkovičs") turn into no word of the thing's, and a swap only of accents
 * ("Brăila", "Brãila") changes nothing the matcher sees: neither counts.
 */
export function mangledText(text: string, forms: string[] = [], known: (word: string) => boolean = () => false): string | null {
  if (text.includes("\uFFFD")) return 'a lost character ("\uFFFD")';
  if (/[^\p{ASCII}]/u.test(text)) {
    const bytes = [...text].map((c) => CP1252_BYTE.get(c));
    if (bytes.every((b) => b !== undefined)) {
      try {
        const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes as number[]));
        if (utf8 !== text) return `UTF-8 read as Windows-1252 ("${utf8}")`;
      } catch {
        // Not UTF-8 in disguise: the usual case for real accented names.
      }
    }
  }
  const own = new Set<string>();
  const ownPlain = new Set<string>();
  for (const f of forms) {
    if (f === text) continue;
    for (const w of f.split(LETTER_RUNS)) {
      own.add(normalize(w));
      if (!misread(w)) ownPlain.add(normalize(w));
    }
  }
  for (const word of text.split(LETTER_RUNS)) {
    const odd = [...new Set(word)].filter((c) => MISREAD.has(c));
    const n = normalize(word);
    if (!odd.length || ownPlain.has(n) || known(n)) continue;
    for (const c of odd) {
      for (const meant of MISREAD.get(c)!) {
        const fixed = word.split(c).join(meant);
        const f = normalize(fixed);
        if (f !== n && own.has(f)) return `"${word}" is "${fixed}" read in the wrong code page`;
      }
    }
  }
  return null;
}

/**
 * Every name or alias on a list that reads as text in the wrong code page (`mangledText`), with why. The words known
 * to be real are English and the words of the list's answers' names (those spelled without a letter that could be
 * misread themselves). build.ts drops such aliases; validate.ts fails any that ship, on every list.
 */
export function mangledForms<E extends { name: string; aliases: string[] }>(entries: E[]): { entry: E; form: string; why: string }[] {
  const names = new Set(entries.flatMap((e) => e.name.split(LETTER_RUNS).filter((w) => !misread(w)).map(normalize)));
  const known = (w: string) => names.has(w) || isEnglishWord(w);
  const out: { entry: E; form: string; why: string }[] = [];
  for (const entry of entries) {
    const forms = [entry.name, ...entry.aliases];
    for (const form of forms) {
      const why = mangledText(form, forms, known);
      if (why) out.push({ entry, form, why });
    }
  }
  return out;
}

/**
 * A table's stand-in for a title that doesn't exist yet: "Untitled Peaky Blinders sequel series", "Awaiting release",
 * "TBA". Never an answer (on netflix-seasons, "peaky blinders" cost a life as one). Works named "Untitled" stay:
 * "Untitled Goose Game", the album "Untitled".
 */
export function placeholderName(name: string): boolean {
  const s = name.trim();
  return (
    /^untitled\b.*\b(series|docuseries|miniseries|film|movie|project|sequel|prequel|spin-?off|season|show|special|documentary|album|tour)$/i.test(s) ||
    /^(awaiting release|to be (announced|determined|confirmed|released)|tba|tbd|tbc|n\/?a)$/i.test(s)
  );
}
