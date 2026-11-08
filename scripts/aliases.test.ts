import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Lexicon } from "../src/game/junk";
import { judgeGuess } from "../src/game/match";
import type { Puzzle } from "../src/game/types";
import { bareWord, blockedAlias, gluedAlias, junkRedirect, mangledText } from "./aliases";

const junk = (raw: string, names: string[], forms: string[] = [], works = false) => junkRedirect(raw, { names, forms, works });

describe("junkRedirect", () => {
  it("drops redirects about an aspect of the thing", () => {
    expect(junk("Child abuse in Saudi Arabia", ["Saudi Arabia"])).not.toBeNull();
    expect(junk("Law of Iran", ["Iran"])).not.toBeNull();
    expect(junk("Topography of the UK", ["United Kingdom"], ["UK"])).not.toBeNull();
    expect(junk("Transportation in New Mexico", ["New Mexico"])).not.toBeNull();
    expect(junk("Disappearing Glaciers in Glacier National Park", ["Glacier", "Glacier National Park"])).not.toBeNull();
  });

  it("keeps names that have 'of' in them", () => {
    expect(junk("State of Kuwait", ["Kuwait"])).toBeNull();
    expect(junk("United States of America", ["United States"])).toBeNull();
    expect(junk("Islamic Republic of Iran", ["Iran"])).toBeNull();
    expect(junk("P.R. of China", ["China"])).toBeNull();
    expect(junk("Saban Field at Bryant–Denny Stadium", ["Bryant–Denny Stadium"])).toBeNull();
    expect(junk("Legend of Zelda", ["The Legend of Zelda"], ["Zelda"])).toBeNull();
    expect(junk("Oracle of Omaha", ["Warren Buffett"])).toBeNull();
  });

  it("drops events, parts and topics, unless the name uses the word", () => {
    expect(junk("1937 Nanga Parbat tragedy", ["Nanga Parbat"])).not.toBeNull();
    expect(junk("Yellowstone Act", ["Yellowstone", "Yellowstone National Park"])).not.toBeNull();
    expect(junk("Glacier National Park Act of 1914", ["Glacier"])).not.toBeNull();
    expect(junk("Makalu Base Camp", ["Makalu"])).not.toBeNull();
    expect(junk("Southeast ridge", ["Mount Everest"])).not.toBeNull();
    expect(junk("Irish politics", ["Ireland"])).not.toBeNull();
    expect(junk("Nou Camp", ["Camp Nou"])).toBeNull();
    expect(junk("Natural History Museum London", ["Natural History Museum"])).toBeNull();
    expect(junk("Blade Runner 2049 film", ["Blade Runner 2049"])).toBeNull();
  });

  it("drops descriptions, sort keys and parts named in a qualifier", () => {
    expect(junk("Highest mountain in Asia", ["Mount Everest"])).not.toBeNull();
    expect(junk("Tale of Two Cities, A", ["A Tale of Two Cities"])).not.toBeNull();
    expect(junk("Musk, Elon", ["Elon Musk"])).not.toBeNull();
    expect(junk("Eminem, Marshall Bruce Mathers III", ["Eminem"], ["Marshall Bruce Mathers III"])).not.toBeNull();
    expect(junk("Atlanta, Georgia", ["Atlanta"])).toBeNull();
    expect(junk("Apple Computer, Inc.", ["Apple"], ["Apple Computer", "Inc."])).toBeNull();
    expect(junk("City (Alaska)", ["Alaska"])).not.toBeNull();
    expect(junk("Wonderful (Wicked song)", ["Wicked"])).not.toBeNull();
    expect(junk("America (United States)", ["United States"])).toBeNull();
    expect(junk("Twitter (X)", ["X"])).toBeNull();
    expect(junk("Alaska (state)", ["Alaska"])).toBeNull();
  });

  it("on works, drops redirects sharing no word with the title (songs, characters)", () => {
    expect(junk("Think of Me", ["The Phantom of the Opera"], [], true)).not.toBeNull();
    expect(junk("Leigh Teabing", ["The Da Vinci Code"], [], true)).not.toBeNull();
    expect(junk("Les Mis", ["Les Misérables"], [], true)).toBeNull();
    expect(junk("Mama Mia", ["Mamma Mia!"], [], true)).toBeNull();
    expect(junk("GTA V", ["Grand Theft Auto V"], [], true)).toBeNull();
    expect(junk("RDR2", ["Red Dead Redemption 2"], [], true)).toBeNull();
    expect(junk("GTAV", ["Grand Theft Auto V"], [], true)).toBeNull();
    expect(junk("TESV", ["The Elder Scrolls V: Skyrim"], [], true)).toBeNull();
    // Not works: nicknames stay.
    expect(junk("Pocket Monsters", ["Pokémon"])).toBeNull();
  });
});

describe("places inside, possessives, web addresses, insults", () => {
  it("drops a place inside the thing, keeps the thing's own name first", () => {
    expect(junk("Kotly, Moscow", ["Moscow"])).not.toBeNull();
    expect(junk("Rio Grande, Rio de Janeiro", ["Rio de Janeiro"])).not.toBeNull();
    expect(junk("Washington, D.C.", ["Washington"])).toBeNull();
    expect(junk("Atlanta, Georgia", ["Atlanta"])).toBeNull();
    expect(junk("Ken Griffey, Jr.", ["Ken Griffey Jr."])).toBeNull();
  });
  it("drops something of the thing's", () => {
    expect(junk("Gretzky's Office", ["Wayne Gretzky"])).not.toBeNull();
    expect(junk("Minecraft's cultural impact", ["Minecraft"])).not.toBeNull();
    expect(junk("Disney's Animal Kingdom", ["Animal Kingdom"])).toBeNull();
    expect(junk("McDonald's Corporation", ["McDonald's"])).toBeNull();
  });
  it("drops web addresses except where they are names", () => {
    expect(junk("Dallascowboys.com", ["Dallas Cowboys"])).not.toBeNull();
    expect(junkRedirect("Google.com", { names: ["Google Search"], webNames: true })).toBeNull();
    expect(junkRedirect("Microsoft.sucks", { names: ["Microsoft"], webNames: true })).not.toBeNull();
  });
  it("drops topics: lobbying, schools, weather", () => {
    expect(junk("Lobbying by Amazon", ["Amazon"])).not.toBeNull();
    expect(junk("Vancouver Christian School", ["Vancouver"])).not.toBeNull();
    expect(junk("Pune weather", ["Pune"])).not.toBeNull();
    expect(junk("School of Rock the Musical", ["School of Rock"])).toBeNull();
  });
  it("blocks slurs and insults, not a name that has the word", () => {
    expect(blockedAlias("T-gay", ["T-Series"])).toBe(true);
    expect(blockedAlias("Sidney Crybaby", ["Sidney Crosby"])).toBe(true);
    expect(blockedAlias("Microsoft.sucks", ["Microsoft"])).toBe(true);
    expect(blockedAlias("Rudy Gay", ["Rudy Gay"])).toBe(false);
    expect(blockedAlias("Gaye", ["Marvin Gaye"])).toBe(false);
  });
});

describe("bareWord and gluedAlias", () => {
  const places = new Set(["australia", "michigan"]);
  it("flags one plain word or place", () => {
    expect(bareWord("Salt", places)).toBe(true);
    expect(bareWord("Australia", places)).toBe(true);
    expect(bareWord("Baikal", places)).toBe(false);
    expect(bareWord("Great Bear", places)).toBe(false);
    expect(bareWord("Gap", places)).toBe(false);
  });
  it("finds names glued without spaces", () => {
    const forms = ["Mount Everest", "Sagarmatha"];
    expect(gluedAlias("Mount EverestSagarmathaChomolungma", forms)).toBe(true);
    expect(gluedAlias("Gasherbrum IIK4", ["Gasherbrum II", "K4"])).toBe(true);
    expect(gluedAlias("LeBronJames", ["LeBron James", "LeBron", "James"])).toBe(false);
    expect(gluedAlias("Mount Everest", forms)).toBe(false);
    expect(gluedAlias("Lotte World 2", ["Lotte World"])).toBe(false);
  });
});

describe("mangledText", () => {
  // Painters' judge: "Eugčne Henri Paul Gauguin" (Eugène written in Windows-1252, read as Windows-1250).
  const gauguin = ["Paul Gauguin", "Eugene Henri Paul Gauguin", "Eugčne Henri Paul Gauguin"];
  it("finds text decoded in the wrong code page", () => {
    expect(mangledText("Eugčne Henri Paul Gauguin", gauguin)).toContain('"Eugène"');
    expect(mangledText("CÃ©zanne", ["Paul Cézanne"])).toContain('"Cézanne"');
    expect(mangledText("Eug�ne Gauguin", [])).not.toBeNull();
    // Two redirects with the same misread word don't vouch for each other.
    expect(mangledText("Eugčne Gauguin", [...gauguin, "Eugčne Gauguin"])).not.toBeNull();
  });
  it("leaves real letters alone, and takes no dictionary word as the fix", () => {
    expect(mangledText("Eugène Henri Paul Gauguin", ["Paul Gauguin", "Eugene Henri Paul Gauguin"])).toBeNull();
    expect(mangledText("Markuss Rotkovičs", ["Mark Rothko", "Markuss Rotkovičs"])).toBeNull();
    expect(mangledText("Æthiopia", ["Ethiopia"])).toBeNull();
    expect(mangledText("João Pessoa", ["João Pessoa"])).toBeNull();
    expect(mangledText("Saša Ilić", ["Saša Ilić"])).toBeNull();
    expect(mangledText("São Paulo", [])).toBeNull();
  });
});

describe("aliases as built: what players type", () => {
  const dir = join(import.meta.dirname, "..", "public", "puzzles");
  const lex: Lexicon = JSON.parse(readFileSync(join(dir, "lexicon.json"), "utf8"));
  /** The entry a guess lands on (corrected or not), with nothing found yet; undefined if none. */
  const lands = (id: string, guess: string) => {
    const r = judgeGuess(guess, JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as Puzzle, new Set(), lex);
    return "entry" in r ? r.entry.name : r.kind;
  };

  it.each([
    // Player report: the A's current name was "Not one of the 30 MLB teams here".
    ["sacramento athletics", "Athletics"],
    ["sacramento a's", "Athletics"],
    ["las vegas athletics", "Athletics"],
    ["athletics", "Athletics"],
    ["oakland a's", "Athletics"],
    ["la angels", "Los Angeles Angels"],
    ["california angels", "Los Angeles Angels"],
    ["ny mets", "New York Mets"],
    ["kc royals", "Kansas City Royals"],
    ["florida marlins", "Miami Marlins"],
    ["devil rays", "Tampa Bay Rays"],
    ["cubbies", "Chicago Cubs"],
    ["brew crew", "Milwaukee Brewers"],
  ])("world-series-wins: %s -> %s", (guess, name) => {
    expect(lands("world-series-wins", guess)).toBe(name);
  });

  it.each([
    // Judge: "chicken egg" offered Chicken (its name starts the guess), not Eggs.
    ["chicken egg", "Eggs"],
    ["chicken eggs", "Eggs"],
    ["hen egg", "Eggs"],
    ["hens egg", "Eggs"],
    ["chicken's egg", "Eggs"],
    ["hen eggs", "Eggs"],
    ["eggs", "Eggs"],
    ["chicken", "Chicken"],
    ["duck egg", "Other birds' eggs"],
  ])("farm-products: %s -> %s", (guess, name) => {
    expect(lands("farm-products", guess)).toBe(name);
  });

  it.each([
    // The usual short names, and Goldman's hedge fund arm as the natural reading of "goldman sachs".
    ["bridgewater", "Bridgewater Associates"],
    ["millennium", "Millennium Management"],
    ["elliott management", "Elliott Investment Management"],
    ["de shaw", "D. E. Shaw & Co."],
    ["d.e. shaw", "D. E. Shaw & Co."],
    ["rentech", "Renaissance Technologies"],
    ["renaissance", "Renaissance Technologies"],
    ["goldman sachs", "Goldman Sachs Asset Management"],
    ["man group", "Man Group"],
    // Proprietary trading firms and market makers are not hedge funds here: free, never read as one.
    ["citadel securities", "unknown"],
    ["citadel securities llc", "unknown"],
    ["two sigma securities", "unknown"],
    ["jane street", "unknown"],
    ["jump trading", "unknown"],
    ["hudson river trading", "unknown"],
    ["optiver", "unknown"],
    ["susquehanna", "unknown"],
    ["virtu", "unknown"],
    ["tower research", "unknown"],
    // "Man" is a word, not Man Group.
    ["man", "unknown"],
  ])("hedge-funds: %s -> %s", (guess, name) => {
    expect(lands("hedge-funds", guess)).toBe(name);
  });

  // Coverage audit, Nov 8: names players type that found nothing, or found the wrong answer, fixed in the data
  // (intent.ts, COUNTRY_FORMS, CITY_FORMS, TEAM_SHORT, topics.ts renames and knownNames). "unknown" is free: a real
  // name the list doesn't have, no longer read as some other answer.
  it.each([
    // Shared country forms: the usual misspellings, Northern Ireland as the UK.
    ["countries-population", "columbia", "Colombia"],
    ["countries-population", "lichtenstein", "Liechtenstein"],
    ["countries-population", "lybia", "Libya"],
    ["countries-population", "republic of congo", "Republic of the Congo"],
    ["countries-population", "northern ireland", "United Kingdom"],
    ["countries-area", "afganistan", "Afghanistan"],
    ["countries-gdp", "guatamala", "Guatemala"],
    ["tourism", "phillipines", "Philippines"],
    ["tourism", "kazakstan", "Kazakhstan"],
    ["olympic-medals", "northern ireland", "Great Britain"],
    ["smallest-countries", "lichtenstein", "Liechtenstein"],
    ["military-spending", "brasil", "Brazil"],
    ["military-spending", "phillipines", "Philippines"],
    ["tea-per-capita", "northern ireland", "United Kingdom"],
    // The bare name offers both Congos, as on the other country lists (it cost a life as the Republic).
    ["africa-population", "congo", "typo"],
    ["africa-population", "dr congo", "Democratic Republic of the Congo"],
    ["ballon-dor-countries", "uk", "England"],
    ["ballon-dor-countries", "great britain", "England"],
    ["smallest-countries", "monte carlo", "Monaco"],
    ["smallest-countries", "sealand", "unknown"],
    // Cities: old names, local names, renamed cities.
    ["india-cities", "allahabad", "Prayagraj"],
    ["india-cities", "calicut", "Kozhikode"],
    ["india-cities", "mangaluru", "Mangalore"],
    ["india-cities", "baroda", "Vadodara"],
    ["india-cities", "aurangabad", "Chhatrapati Sambhajinagar"],
    ["india-cities", "aurangabad bihar", "Aurangabad, Bihar"],
    ["india-cities", "vizag", "Visakhapatnam"],
    ["india-cities", "trivandrum", "Thiruvananthapuram"],
    ["india-cities", "gurugram", "Gurgaon"],
    ["india-cities", "cochin", "Kochi"],
    ["india-cities", "benares", "Varanasi"],
    ["india-cities", "kashi", "Varanasi"],
    ["india-cities", "trichy", "Tiruchirappalli"],
    ["india-cities", "gulbarga", "Kalaburagi"],
    ["india-cities", "new bombay", "Navi Mumbai"],
    ["india-cities", "pondicherry", "Puducherry"],
    ["india-cities", "rajahmundry", "Rajamahendravaram"],
    ["europe-cities", "odessa", "Odesa"],
    ["europe-cities", "praha", "Prague"],
    ["europe-cities", "munchen", "Munich"],
    ["europe-cities", "wien", "Vienna"],
    ["europe-cities", "koln", "Cologne"],
    ["europe-cities", "napoli", "Naples"],
    ["europe-cities", "torino", "Turin"],
    ["europe-cities", "bruxelles", "Brussels"],
    ["europe-cities", "den haag", "The Hague"],
    ["europe-cities", "genova", "Genoa"],
    ["china-cities", "nanking", "Nanjing"],
    ["china-cities", "amoy", "Xiamen"],
    ["china-cities", "soochow", "Suzhou"],
    ["china-cities", "foochow", "Fuzhou"],
    ["china-cities", "mukden", "Shenyang"],
    ["africa-cities", "port elizabeth", "Gqeberha"],
    ["africa-cities", "constantine", "unknown"],
    ["africa-cities", "annaba", "unknown"],
    ["africa-cities", "soweto", "unknown"],
    ["brazil-cities", "rj", "Rio de Janeiro"],
    ["brazil-cities", "floripa", "Florianópolis"],
    ["capitals", "nur-sultan", "Astana"],
    ["capitals", "cape town", "Cape Town"],
    ["capitals", "edinburgh", "unknown"],
    ["city-visitors", "bali", "Denpasar"],
    ["us-cities", "windy city", "Chicago"],
    ["us-cities", "sin city", "Las Vegas"],
    ["us-cities", "motor city", "Detroit"],
    ["us-cities", "h-town", "Houston"],
    ["us-metros", "manhattan", "New York–Newark–Jersey City"],
    ["us-metros", "manhattan kansas", "Manhattan, Kansas"],
    ["us-metros", "ny", "New York–Newark–Jersey City"],
    ["us-metros", "brooklyn", "New York–Newark–Jersey City"],
    ["us-metros", "inland empire", "Riverside–San Bernardino–Ontario"],
    ["us-metros", "tampa bay", "Tampa–St. Petersburg–Clearwater"],
    ["us-metros", "saint louis", "St. Louis"],
    ["us-metros", "silicon valley", "San Jose–Sunnyvale–Santa Clara"],
    ["us-metros", "nola", "New Orleans–Metairie"],
    ["us-metros", "slc", "Salt Lake City–Murray"],
    ["us-metros", "atl", "Atlanta–Sandy Springs–Roswell"],
    ["us-metros", "kc", "Kansas City"],
    // Found probing the same lists (data agent B): wrong corrections and old names.
    ["countries-population", "car", "Central African Republic"],
    ["countries-population", "byelorussia", "Belarus"],
    ["india-cities", "trichur", "Thrissur"],
    ["india-cities", "kannur", "unknown"],
    ["india-cities", "tanjore", "Thanjavur"],
    ["india-cities", "quilon", "Kollam"],
    ["india-cities", "hubballi", "Hubli–Dharwad"],
    ["india-cities", "ayodhya", "Faizabad"],
    ["india-cities", "ndmc", "New Delhi Municipal Council"],
    ["china-cities", "hankow", "unknown"],
    ["china-cities", "lushun", "unknown"],
    ["china-cities", "dairen", "Dalian"],
    ["china-cities", "sining", "Xining"],
    ["china-cities", "kashi", "Kashgar"],
    ["europe-cities", "geneve", "Geneva"],
    ["europe-cities", "salzburg", "unknown"],
    ["europe-cities", "smyrna", "unknown"],
    ["europe-cities", "vilna", "Vilnius"],
    ["europe-cities", "lodz", "Łódź"],
    ["capitals", "akmola", "Astana"],
    ["capitals", "tshwane", "Pretoria"],
    ["world-cities", "batavia", "Jakarta"],
    ["rivers", "kizil river", "Kızıl River"],
    // Other places.
    ["rivers", "missisippi", "Mississippi"],
    ["rivers", "mississipi", "Mississippi"],
    ["rivers", "amazonas", "Amazon"],
    ["deserts", "great victoria desert", "Great Australian Desert"],
    ["deserts", "simpson desert", "Great Australian Desert"],
    ["deserts", "dasht-e kavir", "Great Salt Desert"],
    ["deserts", "dasht-e lut", "Lut Desert"],
    ["deserts", "great indian desert", "Thar Desert"],
    ["deserts", "great salt lake desert", "unknown"],
    ["national-parks", "rockies", "Rocky Mountain"],
    ["stadiums", "cowboys stadium", "AT&T Stadium"],
    ["stadiums", "jerry world", "AT&T Stadium"],
    ["stadiums", "soccer city", "FNB Stadium"],
    ["stadiums", "westfalenstadion", "Signal Iduna Park"],
    ["stadiums", "texas am", "Kyle Field"],
    ["stadiums", "happy valley", "Beaver Stadium"],
    ["stadiums", "rungrado may day", "Rungrado 1st of May Stadium"],
    ["stadiums", "bird's nest", "Beijing National Stadium"],
    ["stadiums", "principality stadium", "Millennium Stadium"],
    ["stadiums", "el monumental", "Estadio Monumental"],
    ["albums", "mmlp", "The Marshall Mathers LP"],
    ["albums", "titanic soundtrack", "Titanic: Music from the Motion Picture"],
    ["banks", "jpm", "JPMorgan Chase"],
    ["consoles", "original xbox", "Xbox"],
    // Sports: short forms, former names, city abbreviations.
    ["nba-assists", "mo cheeks", "Maurice Cheeks"],
    ["nba-assists", "kj", "Kevin Johnson"],
    ["nba-points", "wemby", "Victor Wembanyama"],
    ["nfl-passing-yards", "eli", "Eli Manning"],
    // "the brow" was corrected to LeBron (#1) through "Bron"; "russ" to Russ Grimm, a lineman.
    ["nba-points", "the brow", "Anthony Davis"],
    ["nba-assists", "the brow", "Anthony Davis"],
    ["nba-rebounds", "the brow", "Anthony Davis"],
    ["nba-points", "ad", "Anthony Davis"],
    ["nba-points", "ant man", "Anthony Edwards"],
    ["nfl-passing-yards", "russ", "Russell Wilson"],
    ["nfl-passing-yards", "dak", "Dak Prescott"],
    ["mlb-home-runs", "mr cub", "Ernie Banks"],
    ["mlb-home-runs", "polar bear", "Pete Alonso"],
    ["nhl-goals", "geno", "Evgeni Malkin"],
    ["nhl-points", "lucky luc", "Luc Robitaille"],
    ["super-bowl-wins", "la rams", "Los Angeles Rams"],
    ["super-bowl-wins", "la chargers", "Los Angeles Chargers"],
    ["super-bowl-wins", "ny jets", "New York Jets"],
    ["super-bowl-wins", "sf niners", "San Francisco 49ers"],
    ["super-bowl-wins", "forty niners", "San Francisco 49ers"],
    ["super-bowl-wins", "philly", "Philadelphia Eagles"],
    ["super-bowl-wins", "houston oilers", "Tennessee Titans"],
    ["super-bowl-wins", "san diego chargers", "Los Angeles Chargers"],
    ["world-series-wins", "tb rays", "Tampa Bay Rays"],
    ["world-series-wins", "chi sox", "Chicago White Sox"],
    ["world-series-wins", "philly", "Philadelphia Phillies"],
    ["world-series-wins", "yankee", "New York Yankees"],
    ["world-series-wins", "bronx bombers", "New York Yankees"],
    ["world-series-wins", "senators", "typo"],
    // "los angeles" handed over the Raiders (#9) through their old name; "bums" was corrected to the Pirates.
    ["super-bowl-wins", "los angeles", "Los Angeles Rams"],
    ["super-bowl-wins", "san diego", "Los Angeles Chargers"],
    ["super-bowl-wins", "g-men", "New York Giants"],
    ["super-bowl-wins", "da bears", "Chicago Bears"],
    ["world-series-wins", "bums", "Los Angeles Dodgers"],
    ["world-series-wins", "south siders", "Chicago White Sox"],
    ["world-series-wins", "big red machine", "Cincinnati Reds"],
    // Entertainment.
    ["albums", "black album", "Metallica"],
    ["albums", "abba gold", "Gold: Greatest Hits"],
    ["albums", "adele 21", "21"],
    ["albums", "the fame", "The Fame / The Fame Monster"],
    ["albums", "bob marley legend", "Legend: The Best of Bob Marley & The Wailers"],
    ["media-franchises", "007", "James Bond"],
    ["media-franchises", "tmnt", "Teenage Mutant Ninja Turtles"],
    ["media-franchises", "charlie brown", "Peanuts"],
    ["media-franchises", "dc", "DC Extended Universe"],
    ["media-franchises", "pikachu", "Pokémon"],
    ["media-franchises", "marvel comics", "Marvel Cinematic Universe"],
    ["media-franchises", "sanrio", "Hello Kitty"],
    ["media-franchises", "one piece", "One Piece"],
    ["media-franchises", "game of thrones", "A Song of Ice and Fire"],
    ["media-franchises", "peppa pig", "Peppa Pig"],
    ["media-franchises", "bluey", "Bluey"],
    ["media-franchises", "tetris", "Tetris"],
    ["media-franchises", "fifa", "FIFA"],
    ["media-franchises", "final fantasy", "Final Fantasy"],
    ["media-franchises", "mario kart", "Mario"],
    ["population-density", "gaza", "Palestine"],
    ["population-density", "gaza strip", "Palestine"],
    ["manga", "jojo", "JoJo's Bizarre Adventure"],
    ["manga", "aot", "Attack on Titan"],
    ["manga", "shingeki no kyojin", "Attack on Titan"],
    ["manga", "mha", "My Hero Academia"],
    ["manga", "bnha", "My Hero Academia"],
    ["manga", "fmab", "Fullmetal Alchemist"],
    ["manga", "ranma 1/2", "Ranma ½"],
    ["manga", "hokuto no ken", "Fist of the North Star"],
    ["manga", "kuroko no basket", "Kuroko's Basketball"],
    ["manga", "opm", "One-Punch Man"],
    ["manga", "csm", "Chainsaw Man"],
    ["manga", "sxf", "Spy × Family"],
    ["films-gross", "e.t.", "E.T. the Extra-Terrestrial"],
    ["films-gross", "fast 7", "Furious 7"],
    ["films-gross", "fast and furious 8", "The Fate of the Furious"],
    ["us-box-office", "black panther 2", "Black Panther: Wakanda Forever"],
    ["us-box-office", "spider-man 4", "Spider-Man: Brand New Day"],
    ["us-box-office", "fast and furious 7", "Furious 7"],
    ["us-box-office", "fast and furious", "Furious 7"],
    ["expensive-films", "avatar 3", "Avatar: Fire and Ash"],
    ["pixar-films", "buzz lightyear", "Lightyear"],
    ["broadway", "mj", "MJ the Musical"],
    ["broadway", "six the musical", "Six"],
    ["consoles", "ps vita", "PlayStation Vita"],
    ["consoles", "360", "Xbox 360"],
    ["youtube-channels", "mkbhd", "Marques Brownlee"],
    ["youtube-channels", "pewds", "PewDiePie"],
    ["youtube-channels", "ryan kaji", "Ryan's World"],
    ["youtube-channels", "sony", "SET India"],
    ["youtube-channels", "youtube", "YouTube Spotlight"],
    ["youtube-videos", "baby shark song", "Baby Shark Dance"],
    ["instagram", "kim", "Kim Kardashian"],
    ["instagram", "leo", "Lionel Messi"],
    // Business.
    ["banks", "rbs", "NatWest Group"],
    ["banks", "sbi", "State Bank of India"],
    ["banks", "cba", "Commonwealth Bank"],
    ["banks", "nab", "National Australia Bank"],
    ["banks", "bmo", "Bank of Montreal"],
    ["banks", "socgen", "Société Générale"],
    ["banks", "lloyds bank", "Lloyds Banking Group"],
    ["banks", "boc", "Bank of China"],
    ["market-cap-peak", "ge", "General Electric"],
    ["market-cap-peak", "j&j", "Johnson & Johnson"],
    ["market-cap-peak", "p&g", "Procter & Gamble"],
    ["market-cap-peak", "aig", "American International Group"],
    ["market-cap-peak", "citi", "Citigroup"],
    ["market-cap-peak", "advanced micro devices", "AMD"],
    ["market-cap-peak", "toyota motor", "Toyota"],
    ["market-cap-peak", "tesla motors", "Tesla"],
    ["car-makers", "gac motor", "unknown"],
    ["car-makers", "proton", "Proton Holdings"],
    ["car-makers", "lucid", "Lucid Motors"],
    ["car-makers", "wuling", "SAIC Motor"],
    ["car-makers", "roewe", "SAIC Motor"],
    ["car-makers", "haval", "Great Wall"],
    ["car-makers", "lynk & co", "Geely"],
    ["car-makers", "omoda", "Chery"],
    ["fast-food-chains", "hungry jacks", "Burger King"],
    ["fast-food-chains", "mcdonald", "McDonald's"],
    ["fast-food-chains", "golden arches", "McDonald's"],
    ["fast-food-chains", "chatime", "unknown"],
    ["fast-food-chains", "harveys", "unknown"],
    ["football-club-revenue", "olympique lyonnais", "Lyon"],
    ["football-club-revenue", "om", "Marseille"],
    // Oddball.
    ["dog-breeds", "cocker", "typo"],
    ["dog-breeds", "springer", "typo"],
    ["dog-breeds", "scottie", "Scottish Terrier"],
    ["dog-breeds", "westy", "West Highland White Terrier"],
    ["dog-breeds", "st bernards", "St. Bernard"],
    ["dog-breeds", "wolfhound", "Irish Wolfhound"],
    ["us-surnames", "johnston", "unknown"],
    ["us-surnames", "harrison", "unknown"],
    ["us-surnames", "cohen", "unknown"],
    ["us-surnames", "muller", "unknown"],
  ])("coverage audit: %s, %s -> %s", (id, guess, name) => {
    expect(lands(id, guess)).toBe(name);
  });

  it("coverage audit: real names a list leaves out are never junk", () => {
    const junk = (id: string, guess: string) => {
      const r = judgeGuess(guess, JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as Puzzle, new Set(), lex);
      return r.kind === "unknown" && r.junk;
    };
    expect(junk("dog-breeds", "pitbull")).toBe(false);
    expect(junk("market-cap-peak", "asml")).toBe(false);
    expect(junk("instagram", "9gag")).toBe(false);
    expect(junk("national-parks", "statue of liberty")).toBe(false);
    expect(junk("africa-cities", "oujda")).toBe(false);
  });

  it("painters: Gauguin by ear, and no van Gogh guess turned into him", () => {
    expect(lands("painters", "gogan")).toBe("Paul Gauguin");
    expect(lands("painters", "gauguin")).toBe("Paul Gauguin");
    expect(lands("painters", "gogh")).toBe("Vincent van Gogh");
    expect(lands("painters", "van gogh")).toBe("Vincent van Gogh");
  });
});
