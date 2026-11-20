import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Lexicon } from "../src/game/junk";
import { judgeGuess, normalize } from "../src/game/match";
import type { Puzzle } from "../src/game/types";
import { bareWord, blockedAlias, gluedAlias, junkRedirect, mangledText, otherNamespace } from "./aliases";
import { TOPICS } from "./topics";

const junk = (raw: string, names: string[], forms: string[] = [], works = false) => junkRedirect(raw, { names, forms, works });

describe("otherNamespace", () => {
  // Nov 17: a film category listed "Draft talk:Broked", which joined animated-films as an answer.
  it("finds pages outside the articles, talk pages included", () => {
    for (const t of ["Draft talk:Broked", "Draft:Broked", "Talk:Frozen", "User:Example", "Wikipedia talk:Films", "Template:Pixar", "Category:Films", "Portal:Film"]) {
      expect(otherNamespace(t), t).toBe(true);
    }
  });
  it("leaves titles with a colon alone", () => {
    for (const t of ["Star Wars: The Force Awakens", "Monster: The Jeffrey Dahmer Story", "Help!", "Mission: Impossible", "Talk Talk"]) {
      expect(otherNamespace(t), t).toBe(false);
    }
  });
});

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
    // Coverage audit: other farm products were corrected into answers ("hay" to Pork by its "ham").
    ["hay", "unknown"],
    ["sheep milk", "unknown"],
    ["goat milk", "unknown"],
    ["cocoa", "unknown"],
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
    // Player notes: Point72 and the other real hedge funds the page leaves out are answers (SAC became Point72).
    ["point72", "Point72 Asset Management"],
    ["sac capital", "Point72 Asset Management"],
    ["baupost", "Baupost Group"],
    ["tiger management", "Tiger Management"],
    ["ltcm", "Long-Term Capital Management"],
    ["melvin capital", "Melvin Capital"],
    // Coverage audit: what finance people call them.
    ["soros", "Quantum Fund"],
    ["medallion", "Renaissance Technologies"],
    ["greenlight", "Greenlight Capital"],
    ["scion", "Scion Asset Management"],
    ["d1", "D1 Capital Partners"],
  ])("hedge-funds: %s -> %s", (guess, name) => {
    expect(lands("hedge-funds", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: the borough and the peninsula that hold their city's towers.
    ["manhattan", "New York City"],
    ["kowloon", "Hong Kong"],
    // Real skylines under the page's cut: free, never corrected into another city.
    ["brisbane", "unknown"],
    ["jeddah", "unknown"],
    ["monterrey", "unknown"],
  ])("skyscraper-cities: %s -> %s", (guess, name) => {
    expect(lands("skyscraper-cities", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: what fans call the leagues past #10, which have no redirects of their own.
    ["dutch eredivisie", "Eredivisie"],
    ["liga portugal", "Primeira Liga"],
    ["jupiler pro league", "Belgian Pro League"],
    ["roshn saudi league", "Saudi Professional League"],
    ["aussie rules", "Australian Football League"],
    ["bundesliga 2", "2. Bundesliga"],
    ["milb", "Minor League Baseball"],
    ["cba", "Chinese Basketball Association"],
    ["nbl", "National Basketball League (Australia)"],
    ["j1", "J1 League"],
    ["ligue une", "Ligue 1"],
    ["serie a brazil", "Campeonato Brasileiro Série A"],
    ["spfl", "Scottish Premiership"],
    ["aleague", "A-League Men"],
    // Tours, series and college sport are free, and never junk.
    ["lpga", "unknown"],
    ["usfl", "unknown"],
    ["nascar", "unknown"],
  ])("sports-leagues: %s -> %s", (guess, name) => {
    expect(lands("sports-leagues", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: stores people shop at count for the group Deloitte ranks, as Lidl does for Schwarz.
    ["sam's club", "Walmart"],
    ["flipkart", "Walmart"],
    ["whole foods", "Amazon"],
    ["trader joes", "Aldi"],
    ["tj maxx", "TJX Companies"],
    ["tk maxx", "TJX Companies"],
    ["marshalls", "TJX Companies"],
    ["safeway", "Albertsons"],
    ["food lion", "Ahold Delhaize"],
    ["sephora", "LVMH"],
    ["gucci", "Kering"],
    ["m&s", "Marks & Spencer"],
    ["bjs", "BJ's Wholesale Club"],
    ["7 11", "Seven & I Holdings"],
    ["711", "Seven & I Holdings"],
    ["old navy", "Gap"],
    ["circle k", "Alimentation Couche-Tard"],
    ["bunnings", "Wesfarmers"],
    // Kmart was corrected to Walmart by a "WMart" redirect; famous retailers outside the 100 are free.
    ["kmart", "unknown"],
    ["ebay", "unknown"],
    ["primark", "unknown"],
  ])("retailers: %s -> %s", (guess, name) => {
    expect(lands("retailers", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: "car" was corrected to Czechia (its "ČR"); the usual misspelling and former names.
    ["car", "Central African Republic"],
    ["c.a.r.", "Central African Republic"],
    ["central african rep", "Central African Republic"],
    ["lichtenstein", "Liechtenstein"],
    ["byelorussia", "Belarus"],
    ["upper volta", "Burkina Faso"],
    ["fyrom", "North Macedonia"],
    ["kyrgyz", "Kyrgyzstan"],
    ["lao", "Laos"],
  ])("landlocked-countries: %s -> %s", (guess, name) => {
    expect(lands("landlocked-countries", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: only Hot 100 number ones were answers; billion-stream hits were "not one of the songs here",
    // and real titles were corrected into other songs ("heathens" to Heartless, "seven nation army" to Seven).
    ["levitating", "Levitating"],
    ["shivers", "Shivers"],
    ["gangnam style", "Gangnam Style"],
    ["story of my life", "Story of My Life"],
    ["heathens", "Heathens"],
    ["seven nation army", "Seven Nation Army"],
    ["here comes the sun", "Here Comes the Sun"],
    ["mockingbird", "Mockingbird"],
    ["shape of u", "Shape of You"],
  ])("spotify-songs: %s -> %s", (guess, name) => {
    expect(lands("spotify-songs", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: spin-offs were read as their parent, and the short forms fans write found nothing.
    ["ncis la", "NCIS: Los Angeles"],
    ["ncis hawaii", "unknown"],
    ["law and order criminal intent", "unknown"],
    ["law & order: organized crime", "unknown"],
    ["911", "9-1-1"],
    ["himym", "How I Met Your Mother"],
    ["tbbt", "The Big Bang Theory"],
    ["xfiles", "The X-Files"],
    ["l&o", "Law & Order"],
    ["law n order", "Law & Order"],
  ])("longest-running-tv: %s -> %s", (guess, name) => {
    expect(lands("longest-running-tv", guess)).toBe(name);
  });

  it.each([
    // Owner: "makkah royal clock tower" should count, and Mecca's other spellings with it.
    ["makkah royal clock tower", "Mecca Royal Clock Tower"],
    ["makkah clock tower", "Mecca Royal Clock Tower"],
    ["mekkah clock tower", "Mecca Royal Clock Tower"],
    // Coverage audit: "tower" is generic, so these found nothing or the wrong tower.
    ["merdeka tower", "Merdeka Maybank Tower"],
    ["pnb tower", "Merdeka Maybank Tower"],
    ["ping an tower", "Ping An Finance Centre"],
    ["trump tower chicago", "Trump International Hotel and Tower"],
    ["wtc", "One World Trade Center"],
    ["kingdom tower", "Jeddah Tower"],
    // Towers that aren't buildings are free, not junk.
    ["tokyo skytree", "unknown"],
  ])("buildings: %s -> %s", (guess, name) => {
    expect(lands("buildings", guess)).toBe(name);
  });

  it("islands: what Hawaii calls its biggest island (coverage audit)", () => {
    expect(lands("islands", "big island")).toBe("Hawaiʻi");
    expect(lands("islands", "hawaii island")).toBe("Hawaiʻi");
  });

  it.each([
    // Coverage audit: the category stopped at "Mb", and some surnames are plain words or untypeable letters.
    ["rashford", "Marcus Rashford"],
    ["cole palmer", "Cole Palmer"],
    ["palmer", "Cole Palmer"],
    ["fernando torres", "Fernando Torres"],
    ["solskjaer", "Ole Gunnar Solskjær"],
    ["odegaard", "Martin Ødegaard"],
    ["hojlund", "Rasmus Højlund"],
    ["hazard", "Eden Hazard"],
    ["bale", "Gareth Bale"],
    ["declan rice", "Declan Rice"],
  ])("premier-league-goals: %s -> %s", (guess, name) => {
    expect(lands("premier-league-goals", guess)).toBe(name);
  });

  it("premier-league-goals: the owner's note, the players' average is lower (par 4, not 5)", () => {
    const par = JSON.parse(readFileSync(join(dir, "par.json"), "utf8"));
    expect(par["premier-league-goals"].par).toBeLessThanOrEqual(4);
  });

  it("passwords: the prompt names the ranking and says an answer is exact (player note on 88888888)", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "passwords.json"), "utf8"));
    expect(p.prompt).toMatch(/NordPass/);
    expect(p.prompt).toMatch(/exactly/);
    expect(lands("passwords", "888888")).toBe("888888");
    expect(lands("passwords", "i love you")).toBe("iloveyou");
  });

  it.each([
    // Coverage audit: only 75 companies were answers; the companies a casual player names first were "not one of
    // the companies here".
    ["home depot", "The Home Depot"],
    ["coca cola", "Coca-Cola"],
    ["sony", "Sony"],
    ["allianz", "Allianz"],
    ["ups", "United Parcel Service"],
    ["disney", "Walt Disney"],
    ["ikea", "Ingka Group"],
    ["vw", "Volkswagen Group"],
    ["j&j", "Johnson & Johnson"],
    ["p&g", "Procter & Gamble"],
    // A plain word is no company of the S&P 500 ("Ball Corporation").
    ["ball", "unknown"],
  ])("companies-revenue: %s -> %s", (guess, name) => {
    expect(lands("companies-revenue", guess)).toBe(name);
  });

  it("companies-revenue: a miss shows its revenue from the US or European ranking", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "companies-revenue.json"), "utf8"));
    const value = (name: string) => p.extras.find((e) => e.name === name)?.value;
    expect(value("The Home Depot")).toMatch(/^\$\d+ billion \(Fortune 500, 2025\)$/);
    expect(value("Allianz")).toMatch(/^\$\d+ billion \(Fortune Global 500, 2026\)$/);
  });

  it.each([
    // Coverage audit: "snapchat" was corrected to Stripchat; big sites outside the two categories found nothing.
    ["snapchat", "Snapchat"],
    ["discord", "Discord"],
    ["spotify", "Spotify"],
    ["bbc", "BBC"],
    ["tumblr", "Tumblr"],
    ["hotmail", "Outlook.com"],
    ["office", "Microsoft 365"],
    ["google gemini", "Gemini"],
  ])("websites: %s -> %s", (guess, name) => {
    expect(lands("websites", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: franchises outside the top category, free-to-play series, and what players call them.
    ["warcraft", "Warcraft"],
    ["world of warcraft", "Warcraft"],
    ["fortnite", "Fortnite"],
    ["lol", "League of Legends"],
    ["the last of us", "The Last of Us"],
    ["angry birds", "Angry Birds"],
    ["csgo", "Counter-Strike"],
    ["pes", "Pro Evolution Soccer"],
    ["sims 4", "The Sims"],
  ])("game-franchises: %s -> %s", (guess, name) => {
    expect(lands("game-franchises", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: the by-year, franchise and studio tables' films ("cars" was corrected to Cars 2).
    ["toy story 2", "Toy Story 2"],
    ["wall-e", "WALL-E"],
    ["encanto", "Encanto"],
    ["kung fu panda 4", "Kung Fu Panda 4"],
    ["cars", "Cars"],
    ["zootropolis", "Zootopia"],
    // A short form two films share ("Demon Slayer") no longer merges the second into the first.
    ["demon slayer mugen train", "Demon Slayer: Kimetsu no Yaiba Mugen Train"],
    // Films not out yet are no answers.
    ["frozen 3", "unknown"],
  ])("animated-films: %s -> %s", (guess, name) => {
    expect(lands("animated-films", guess)).toBe(name);
  });

  it("animated-films: one Lion King per film, not a third from the franchise table", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "animated-films.json"), "utf8"));
    expect([...p.answers, ...p.extras].filter((e) => e.name.startsWith("The Lion King")).map((e) => e.name).sort()).toEqual([
      "The Lion King (1994)", "The Lion King (2019)", "The Lion King 1½",
    ]);
  });

  it("gdp-per-capita: Monaco and the other rows with no IMF figure are answers with the World Bank's (coverage audit)", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "gdp-per-capita.json"), "utf8"));
    expect(lands("gdp-per-capita", "monaco")).toBe("Monaco");
    expect(p.extras.find((e) => e.name === "Monaco")?.value).toMatch(/World Bank, 20\d\d\)$/);
    expect(lands("gdp-per-capita", "lichtenstein")).toBe("Liechtenstein");
  });

  it.each([
    // Coverage audit: common guesses and spellings ("sassanids" was corrected to the Umayyads, #8).
    ["ussr", "Soviet Union"],
    ["nazi germany", "Nazi Germany"],
    ["rome", "Roman Empire"],
    ["sassanids", "Sasanian Empire"],
    ["mogul empire", "Mughal Empire"],
    ["byzantium", "Byzantine Empire"],
    ["golden horde", "Jochi Khanate"],
    ["austria-hungary", "Austro-Hungarian Empire"],
    ["england", "British Empire"],
  ])("empires: %s -> %s", (guess, name) => {
    expect(lands("empires", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: the rest of the Harry Potter series, and famous single books the page leaves out.
    ["goblet of fire", "Harry Potter and the Goblet of Fire"],
    ["deathly hallows", "Harry Potter and the Deathly Hallows"],
    ["the lion the witch and the wardrobe", "The Lion, the Witch and the Wardrobe"],
    ["1984", "Nineteen Eighty-Four"],
    // Religious texts and series are outside the prompt: free.
    ["the bible", "unknown"],
    ["lord of the rings", "unknown"],
  ])("books: %s -> %s", (guess, name) => {
    expect(lands("books", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: the authors the page leaves out "because no exact figures could be found", and others.
    ["dickens", "Charles Dickens"],
    ["jane austen", "Jane Austen"],
    ["hemingway", "Ernest Hemingway"],
    ["conan doyle", "Arthur Conan Doyle"],
    ["mark twain", "Mark Twain"],
    ["george rr martin", "George R. R. Martin"],
    ["oda", "Eiichiro Oda"],
  ])("fiction-authors: %s -> %s", (guess, name) => {
    expect(lands("fiction-authors", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: classic best-sellers outside the table, with their platform's figure.
    ["nintendogs", "Nintendogs"],
    ["diablo 3", "Diablo III"],
    ["brain age", "Brain Age: Train Your Brain in Minutes a Day!"],
    ["super mario world", "Super Mario World"],
    ["mario kart ds", "Mario Kart DS"],
    ["gta 4", "Grand Theft Auto IV"],
    ["rdr", "Red Dead Redemption"],
  ])("video-games: %s -> %s", (guess, name) => {
    expect(lands("video-games", guess)).toBe(name);
  });

  it("video-games: a game shows its own platform's figure, not a re-release's", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "video-games.json"), "utf8"));
    expect(p.extras.find((e) => e.name === "Super Mario Bros. 3")?.value).toMatch(/\(on NES\)$/);
  });

  it.each([
    // Agent B: these merged into other films through a short form ("Star Wars") or a junk alias ("Spider-Man 3").
    ["the phantom menace", "Star Wars: Episode I – The Phantom Menace"],
    ["spider-man 3", "Spider-Man 3"],
    ["the two towers", "The Lord of the Rings: The Two Towers"],
    ["rogue one", "Rogue One: A Star Wars Story"],
  ])("films-gross: %s -> %s", (guess, name) => {
    expect(lands("films-gross", guess)).toBe(name);
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
    ["africa-cities", "saint louis", "unknown"],
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

  it.each([
    // Coverage audit (Nov 8), built Nov 10 after their dailies: "bahasa", "deutsch" and "yue" missed; the ranked
    // table stops near #38, so Polish, Dutch and Greek were unknown and Aramaic was corrected into Arabic. The ISO
    // 639-1 table and its other names (Valencian, Flemish) fill the gap.
    ["languages", "bahasa", "Indonesian"],
    ["languages", "deutsch", "Standard German"],
    ["languages", "yue", "Yue Chinese"],
    ["languages", "polish", "Polish"],
    ["languages", "malayalam", "Malayalam"],
    ["languages", "sindhi", "Sindhi"],
    ["languages", "catalan", "Catalan"],
    ["languages", "valencian", "Catalan"],
    ["languages", "dutch", "Dutch"],
    ["languages", "greek", "Greek"],
    ["languages", "aramaic", "Aramaic"],
    ["languages", "maldivian", "Dhivehi"],
    // The ISO rows of ranked languages stay those entries.
    ["languages", "chinese", "Mandarin Chinese"],
    ["languages", "arabic", "Modern Standard Arabic"],
    ["languages", "punjabi", "Western Punjabi"],
    ["languages", "persian", "Iranian Persian"],
    // Today's chart artists, the Spotify hand list, boy bands and girl groups; Kanye's legal name.
    ["music-artists", "ye", "Kanye West"],
    ["music-artists", "bts", "BTS"],
    ["music-artists", "bad bunny", "Bad Bunny"],
    ["music-artists", "billie eilish", "Billie Eilish"],
    ["music-artists", "kendrick lamar", "Kendrick Lamar"],
    ["music-artists", "morgan wallen", "Morgan Wallen"],
    ["music-artists", "one direction", "One Direction"],
    ["music-artists", "nsync", "NSYNC"],
    ["music-artists", "tlc", "TLC"],
    // Provincial and territorial capitals below the top 100.
    ["canada-cities", "charlottetown", "Charlottetown"],
    ["canada-cities", "whitehorse", "Whitehorse"],
    ["canada-cities", "yellowknife", "Yellowknife"],
    ["canada-cities", "iqaluit", "Iqaluit"],
    // Shared country forms ("lybia" and "northern ireland" found nothing before the rebuild).
    ["coffee-countries", "columbia", "Colombia"],
    ["coffee-countries", "brasil", "Brazil"],
    ["coffee-countries", "guatamala", "Guatemala"],
    ["coffee-countries", "lybia", "Libya"],
    ["coffee-countries", "northern ireland", "United Kingdom"],
  ])("coverage audit, protected lists: %s, %s -> %s", (id, guess, name) => {
    expect(lands(id, guess)).toBe(name);
  });

  it("coverage audit, protected lists: no language corrected into a ranked one, no rapper read as junk", () => {
    expect(lands("languages", "sindhi")).not.toBe("Hindi");
    expect(lands("languages", "catalan")).not.toBe("Spanish");
    const r = judgeGuess("6ix9ine", JSON.parse(readFileSync(join(dir, "music-artists.json"), "utf8")) as Puzzle, new Set(), lex);
    expect(r.kind === "unknown" && r.junk).toBe(false);
  });

  it.each([
    // Coverage audit: today's big streaming artists were "not one of the artists here".
    ["sabrina carpenter", "Sabrina Carpenter"],
    ["morgan wallen", "Morgan Wallen"],
    ["peso pluma", "Peso Pluma"],
    ["rose", "Rosé"],
    ["avicii", "Avicii"],
    ["radiohead", "Radiohead"],
  ])("spotify-artists: %s -> %s", (guess, name) => {
    expect(lands("spotify-artists", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: the names visitors use; "science museum" was corrected to China's (#7).
    ["science museum", "London Science Museum"],
    ["v&a", "Victoria and Albert Museum"],
    ["uffizi gallery", "Galleria degli Uffizi"],
    ["museo del prado", "Prado Museum"],
    ["orsay", "Musée d'Orsay"],
    ["natural history museum london", "Natural History Museum, South Kensington"],
    ["forbidden city", "Palace Museum"],
  ])("museums: %s -> %s", (guess, name) => {
    expect(lands("museums", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: "alcaraz" was corrected to Canelo (#2); past stars are free on purpose, and never read as
    // another athlete.
    ["alcaraz", "unknown"],
    ["tiger woods", "unknown"],
    ["mayweather", "unknown"],
    ["neymar jr", "Neymar"],
    ["dak", "Dak Prescott"],
  ])("athletes-earnings: %s -> %s", (guess, name) => {
    expect(lands("athletes-earnings", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: China's and Japan's richest and the famous US billionaires were "not one of the people here".
    ["jack ma", "Jack Ma"],
    ["pony ma", "Ma Huateng"],
    ["zhong shanshan", "Zhong Shanshan"],
    ["tadashi yanai", "Tadashi Yanai"],
    ["oprah", "Oprah Winfrey"],
    ["donald trump", "Donald Trump"],
  ])("richest-people: %s -> %s", (guess, name) => {
    expect(lands("richest-people", guess)).toBe(name);
  });

  it.each([
    // Coverage audit: famous nameplates the page lists only as a brand's second, the model alone, the VW Bus.
    ["rav4", "Toyota RAV4"],
    ["cr-v", "Honda CR-V"],
    ["ford focus", "Ford Focus"],
    ["miata", "Mazda MX-5"],
    ["911", "Porsche 911"],
    ["2cv", "Citroën 2CV"],
    ["vw bus", "Volkswagen Type 2"],
    ["altima", "Nissan Altima"],
  ])("car-models: %s -> %s", (guess, name) => {
    expect(lands("car-models", guess)).toBe(name);
  });

  it("painters: Gauguin by ear, and no van Gogh guess turned into him", () => {
    expect(lands("painters", "gogan")).toBe("Paul Gauguin");
    expect(lands("painters", "gauguin")).toBe("Paul Gauguin");
    expect(lands("painters", "gogh")).toBe("Vincent van Gogh");
    expect(lands("painters", "van gogh")).toBe("Vincent van Gogh");
  });

  it("painters: the usual slip on da Vinci, and famous painters the ranking leaves out say so (coverage audit, Nov 13)", () => {
    expect(lands("painters", "di vinci")).toBe("Leonardo da Vinci");
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "painters.json"), "utf8"));
    // Mondrian and Schiele joined the pool with their record sales (owner, Nov 18, below).
    for (const name of ["whistler", "bruegel", "durer", "van eyck", "koons", "klee", "money"]) {
      expect(judgeGuess(name, p, new Set(), lex), name).toMatchObject({ kind: "unknown", known: true });
    }
  });

  describe("owner, Nov 18: famous names count", () => {
    // "you should allow ppl to guess frida, sorolla, etc- ppl dont even know that many artists so its even
    // frustrating when 2 out of 5 they know cant even be guessed": Kahlo, Sorolla, Vermeer and Michelangelo read
    // "isn't in this ranking". A famous name is an answer with its figure (it costs a life below #10); one with no
    // figure anywhere is free and said plainly.
    const puzzle = (id: string): Puzzle => JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
    const answer = (id: string, guess: string) => {
      const r = judgeGuess(guess, puzzle(id), new Set(), lex);
      return r.kind === "near" || r.kind === "correct" ? { kind: r.kind, corrected: r.corrected, name: r.entry.name, rank: r.entry.rank, value: r.entry.value } : r;
    };
    it.each([
      ["frida kahlo", "Frida Kahlo", "$54.7 million (2025)"],
      ["frida", "Frida Kahlo", "$54.7 million (2025)"],
      ["vermeer", "Johannes Vermeer", "$30 million (2004)"],
      ["okeeffe", "Georgia O'Keeffe", "$44.4 million (2014)"],
      ["turner", "J. M. W. Turner", "£30.3 million (2014)"],
      ["constable", "John Constable", "€25.8 million (2012)"],
      ["goya", "Francisco Goya", "$7.9 million (1992)"],
      ["velazquez", "Diego Velázquez", "$5.5 million (1970)"],
      ["toulouse lautrec", "Henri de Toulouse-Lautrec", "$22.4 million (2005)"],
      ["chagall", "Marc Chagall", "$28.5 million (2017)"],
      // His highest price on Wikipedia (2017), above the 2012 record the page names (coordinator, Nov 18).
      ["miro", "Joan Miró", "£24.6 million (2017)"],
      ["banksy", "Banksy", "$25.3 million (2021)"],
      ["richter", "Gerhard Richter", "$44.52 million (2015)"],
      ["kusama", "Yayoi Kusama", "$7.1 million (2014)"],
      ["mondrian", "Piet Mondrian", "$51 million (2022)"],
      ["rockwell", "Norman Rockwell", "$46 million (2013)"],
      ["diego rivera", "Diego Rivera", "$14.1 million (2022)"],
      ["manet", "Édouard Manet", "$65.1 million"],
      ["matisse", "Henri Matisse", "$80.8 million"],
      ["hopper", "Edward Hopper", "$91.9 million"],
      ["botticelli", "Sandro Botticelli", "$92.2 million"],
      ["titian", "Titian", "$71.7 million"],
      ["renoir", "Pierre-Auguste Renoir", "$78.1 million"],
      ["magritte", "René Magritte", "$121.2 million"],
      ["hockney", "David Hockney", "$90.3 million"],
      ["basquiat", "Jean-Michel Basquiat", "$110.5 million"],
      ["lichtenstein", "Roy Lichtenstein", "$165.0 million"],
      ["bacon", "Francis Bacon", "$142.4 million"],
      ["freud", "Lucian Freud", "$86.3 million"],
    ])("painters: %s is %s, ranked, with %s", (guess, name, value) => {
      expect(answer("painters", guess)).toMatchObject({ kind: "near", corrected: false, name, value });
      expect((answer("painters", guess) as { rank: number }).rank).toBeGreaterThan(10);
    });
    it("painters: every painter in the pool lands as itself, with a figure", () => {
      const p = puzzle("painters");
      expect(p.answers.length + p.extras.length).toBeGreaterThanOrEqual(65);
      for (const e of [...p.answers, ...p.extras]) {
        expect(e.rank, e.name).toBeGreaterThan(0);
        expect(e.value, e.name).toBeTruthy();
        expect(answer("painters", e.name), e.name).toMatchObject({ name: e.name, corrected: false });
      }
    });
    it("painters: no sale on record reads plainly and costs nothing", () => {
      for (const name of ["michelangelo", "caravaggio", "joaquin sorolla", "sorolla", "degas", "el greco", "hokusai", "bob ross"]) {
        expect(judgeGuess(name, puzzle("painters"), new Set(), lex), name).toMatchObject({ kind: "unknown", known: true });
      }
    });
    // Coordinator, Nov 18: "Kandinsky is #62 with $23.3 million" tells the player that's his top price, so a figure
    // below the table's line must be the painter's record, not just a sale. One Wikipedia doesn't call their record
    // (Dalí's £8.31 million in 2020, Raphael's, Schiele's, Zhang Daqian's, Haring's) shows nothing: the painter is free.
    // So does a record we know was beaten later: Kandinsky's $23.3 million (2016), beaten in 2017 and 2023.
    it("painters: every figure from an article is the painter's record, with the words saying so", () => {
      const rows = TOPICS.find((t) => t.id === "painters")!.textRows ?? [];
      expect(rows.length).toBeGreaterThan(20);
      for (const r of rows) expect(r.record, r.name).toBeTruthy();
    });
    it("painters: a sale that isn't the painter's record is no figure: they're free", () => {
      for (const name of ["dali", "salvador dali", "raphael", "schiele", "egon schiele", "haring", "keith haring", "zhang daqian", "kandinsky", "wassily kandinsky"]) {
        expect(judgeGuess(name, puzzle("painters"), new Set(), lex), name).toMatchObject({ kind: "unknown", known: true });
      }
    });
    it.each([
      ["fiction-authors", "jeff kinney", "Jeff Kinney"],
      ["fiction-authors", "eric carle", "Eric Carle"],
      ["fiction-authors", "sarah j maas", "Sarah J. Maas"],
      ["fiction-authors", "harper lee", "Harper Lee"],
      ["fiction-authors", "colleen hoover", "Colleen Hoover"],
      ["spotify-artists", "rosalia", "Rosalía"],
      ["spotify-artists", "dolly parton", "Dolly Parton"],
      ["spotify-artists", "lorde", "Lorde"],
      ["spotify-artists", "snoop dogg", "Snoop Dogg"],
      ["spotify-artists", "50 cent", "50 Cent"],
      ["spotify-artists", "tupac", "Tupac Shakur"],
      ["music-artists", "dolly parton", "Dolly Parton"],
      ["music-artists", "2pac", "Tupac Shakur"],
      ["grand-slam-titles", "del potro", "Juan Martín del Potro"],
      ["youtube-videos", "thinking out loud", "Thinking Out Loud"],
      ["youtube-videos", "hello", "Hello"],
      ["youtube-videos", "never gonna give you up", "Never Gonna Give You Up"],
      ["youtube-videos", "rickroll", "Never Gonna Give You Up"],
      ["youtube-videos", "havana", "Havana"],
      ["youtube-videos", "justin bieber baby", "Baby"],
      ["albums", "graceland", "Graceland"],
      ["albums", "ok computer", "OK Computer"],
      ["books", "the diary of a young girl", "The Diary of Anne Frank"],
    ])("%s: %s is %s, at once", (id, guess, name) => {
      expect(answer(id, guess)).toMatchObject({ kind: "near", corrected: false, name });
    });
    it("youtube-videos: a famous video below the top 30 ranks with its dated count", () => {
      expect(answer("youtube-videos", "thinking out loud")).toMatchObject({ rank: 30, value: "3.9 (2025)" });
      expect(answer("youtube-videos", "havana")).toMatchObject({ value: "1.11 (2025)" });
    });
    it("fiction-authors: famous authors with no figure anywhere are known names, not \"not one of the authors\"", () => {
      for (const name of ["george orwell", "haruki murakami", "john steinbeck", "toni morrison", "margaret atwood", "lee child"]) {
        expect(judgeGuess(name, puzzle("fiction-authors"), new Set(), lex), name).toMatchObject({ kind: "unknown", known: true });
      }
    });
    it.each([
      ["albums", ["revolver", "the white album", "kind of blue", "divide", "physical graffiti"]],
      ["books", ["don quixote", "moby dick", "think and grow rich"]],
    ])("%s: famous ones with no figure are known names", (id, names) => {
      for (const name of names) expect(judgeGuess(name, puzzle(id), new Set(), lex), name).toMatchObject({ kind: "unknown", known: true });
    });
  });

  it.each([
    // Builder's fan run (Nov 13): her maiden name, the nicknames, and a married name in the champions' cells.
    ["margaret smith", "Margaret Court"],
    ["margaret smith court", "Margaret Court"],
    ["court", "Margaret Court"],
    ["rafa", "Rafael Nadal"],
    ["fedex", "Roger Federer"],
    ["pistol pete", "Pete Sampras"],
    ["helen wills", "Helen Wills Moody"],
    ["chrissie evert", "Chris Evert"],
    ["billie jean king", "Billie Jean King"],
    // Champions show their count ("McEnroe: 7"); famous players with no singles major are real names, free.
    ["mcenroe", "John McEnroe"],
    ["kyrgios", "unknown"],
    ["kournikova", "unknown"],
    // The judge, Nov 13: Djokovic as it sounds.
    ["jokovic", "Novak Djokovic"],
    ["jokovich", "Novak Djokovic"],
    ["novak jokovic", "Novak Djokovic"],
  ])("grand-slam-titles: %s -> %s", (guess, name) => {
    expect(lands("grand-slam-titles", guess)).toBe(name);
  });

  it("grand-slam-titles: a champion the cells name by her married name is the ranked answer, not a second one", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "grand-slam-titles.json"), "utf8"));
    const names = [...p.answers, ...p.extras].map((e) => e.name);
    expect(names).not.toContain("Margaret Smith Court");
    expect(names).not.toContain("Billie Jean Moffitt King");
    expect(names.filter((n) => n === "Billie Jean King")).toHaveLength(1);
  });

  it.each([
    // "ROC" is a name of Taiwan too: ranked, the Russian Olympic Committee once took all of Taiwan's names. It is an
    // entry of its own now (the judge, Nov 13), with none of them.
    ["taiwan", "Taiwan"],
    ["chinese taipei", "Taiwan"],
    ["republic of china", "Taiwan"],
    ["roc", "Russian Olympic Committee"],
    ["russian olympic committee", "Russian Olympic Committee"],
    ["russia", "Russia"],
    ["russian federation", "Russia"],
    ["ussr", "Soviet Union"],
    ["uk", "Great Britain"],
    // Coverage audit (Nov 13): "team canada" found nothing, where "team usa" and "team gb" land.
    ["team canada", "Canada"],
    ["team usa", "United States"],
    ["team gb", "Great Britain"],
  ])("winter-olympics-countries: %s -> %s", (guess, name) => {
    expect(lands("winter-olympics-countries", guess)).toBe(name);
  });

  it.each([
    ["manhattan", "New York City"],
    ["delhi", "New Delhi"],
    ["bombay", "Mumbai"],
    ["sf", "San Francisco"],
  ])("billionaire-cities: %s -> %s", (guess, name) => {
    expect(lands("billionaire-cities", guess)).toBe(name);
  });

  it.each([
    // The rows link the wine articles, whose redirects are regions: the countries' own names count.
    ["aussie", "Australia"],
    ["rsa", "South Africa"],
    ["stellenbosch", "unknown"],
    // Wine words are free and never read as a country ("napa" as Nepal).
    ["napa", "unknown"],
    ["champagne", "unknown"],
  ])("wine-countries: %s -> %s", (guess, name) => {
    expect(lands("wine-countries", guess)).toBe(name);
  });

  it.each([
    // Builder's fan run (Nov 13): Australia's short forms found nothing.
    ["aus", "Australia"],
    ["oz", "Australia"],
    ["korea", "South Korea"],
    ["swiss", "Switzerland"],
    ["nippon", "Japan"],
    // Sovereign states only: the table's territories are free, and Liechtenstein, which has no UN figure on the page.
    ["hong kong", "unknown"],
    ["macau", "unknown"],
    ["french polynesia", "unknown"],
    ["liechtenstein", "unknown"],
    // The judge (Nov 13): the UN note on the table ranks Monaco and San Marino, above Japan.
    ["monaco", "Monaco"],
    ["san marino", "San Marino"],
    // Coverage audit (Nov 13): Monaco's district said it isn't in the ranking; "lux" found nothing.
    ["monte carlo", "Monaco"],
    ["lux", "Luxembourg"],
    // Redirects that are no name for the country.
    ["andorran navy", "unknown"],
  ])("life-expectancy-countries: %s -> %s", (guess, name) => {
    expect(lands("life-expectancy-countries", guess)).toBe(name);
  });

  it("life-expectancy-countries: Monaco and San Marino rank from the UN's note, and Japan's fact is true (the judge, Nov 13)", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "life-expectancy-countries.json"), "utf8"));
    expect(p.answers.map((e) => e.name)).toEqual([
      "Monaco", "San Marino", "Japan", "South Korea", "Andorra", "Switzerland", "Australia", "Singapore", "Italy", "Spain",
    ]);
    expect(p.answers.slice(0, 2).map((e) => e.value)).toEqual(["86.37 years", "85.71 years"]);
    for (const e of p.answers) expect(e.fact, e.name).toBeDefined();
    // Hong Kong, a territory, tops the UN table: Japan is not "first on the UN's figures".
    expect(p.answers.find((e) => e.name === "Japan")?.fact?.text).not.toMatch(/^First/);
    expect(p.answers.find((e) => e.name === "San Marino")?.aliases).not.toContain("Liberation from the Alberoni Occupation");
  });

  it.each([
    ["lux", "Luxembourg"],
    ["holland", "Netherlands"],
    ["suomi", "Finland"],
    ["danish", "Denmark"],
    // An old report's "Europe" row is no country, and a dependency no report ranks is free.
    ["europe", "unknown"],
    ["greenland", "unknown"],
    ["bhutan", "Bhutan"],
  ])("happiest-countries: %s -> %s", (guess, name) => {
    expect(lands("happiest-countries", guess)).toBe(name);
  });

  it("happiest-countries: ties take the report's own rank, and a country no report ranks says so (the judge, Nov 13)", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "happiest-countries.json"), "utf8"));
    const of = (name: string) => [...p.answers, ...p.extras].find((e) => e.name === name);
    // Both 6.821 to three decimals; the report ranks Czechia #20 and the UAE #21.
    expect(of("Czechia")?.rank).toBe(20);
    expect(of("United Arab Emirates")?.rank).toBe(21);
    for (const c of ["Monaco", "Liechtenstein", "San Marino", "Vatican City", "North Korea"]) {
      expect(of(c), c).toMatchObject({ rank: 0, value: "not in any report" });
      expect(of(c)?.n, c).toBeUndefined();
    }
    expect(of("Bhutan")?.value).toBe("#95 in the 2019 report");
    expect(of("Israel")?.fact?.text).toMatch(/since 2022/);
  });

  it.each([
    // How Australians shorten their cities, and the places an urban area joins.
    ["syd", "Sydney"],
    ["melb", "Melbourne"],
    ["brissie", "Brisbane"],
    ["brisvegas", "Brisbane"],
    ["goldie", "Gold Coast"],
    ["sunny coast", "Sunshine Coast"],
    ["queanbeyan", "Canberra"],
    ["central coast", "Central Coast"],
    ["gosford", "Central Coast"],
    ["greater sydney", "Sydney"],
    ["hobart", "Hobart"],
    // Suburbs and sights inside the urban areas are free.
    ["fremantle", "unknown"],
    ["surfers paradise", "unknown"],
    // The judge (Nov 13): towns the source puts inside Melbourne's, Sydney's and Adelaide's urban areas cost a life
    // as answers outside the ranking. They are part of #1, #2 and #5: free.
    ["melton", "unknown"],
    ["sunbury", "unknown"],
    ["blue mountains", "unknown"],
    ["gawler", "unknown"],
    // "South Coast" is the NSW one to Australians, not the Gold Coast; the full name still is.
    ["south coast", "unknown"],
    ["south coast queensland", "Gold Coast"],
    // Coverage audit (Nov 13): a nickname found nothing, two short forms were only offered.
    ["newy", "Newcastle"],
    ["wagga", "Wagga Wagga"],
    ["coffs", "Coffs Harbour"],
  ])("australia-cities: %s -> %s", (guess, name) => {
    expect(lands("australia-cities", guess)).toBe(name);
  });

  it("australia-cities: towns inside an urban area say so plainly, and the facts say why Melbourne leads", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "australia-cities.json"), "utf8"));
    for (const town of ["melton", "gawler", "maroochydore", "ipswich", "penrith"]) {
      expect(judgeGuess(town, p, new Set(), lex), town).toMatchObject({ kind: "unknown", known: true });
    }
    expect(p.answers.find((e) => e.name === "Melbourne")?.fact?.text).toMatch(/Greater Sydney/);
    // Alice Springs and Mount Gambier really have the same figure: the ABS cube the page cites agrees (Nov 13).
    const alice = p.extras.find((e) => e.name === "Alice Springs");
    expect(alice?.value).toBe("30,875");
  });

  it.each([
    // Coverage audit (Nov 13): what riders call their systems, and Korea's older romanization, found nothing.
    ["mta", "New York City"],
    ["wmata", "Washington, D.C."],
    ["dc metro", "Washington, D.C."],
    ["ttc", "Toronto"],
    ["septa", "Philadelphia"],
    ["subte", "Buenos Aires"],
    ["metro de paris", "Paris"],
    ["metro de madrid", "Madrid"],
    ["delhi ncr", "Delhi"],
    ["pusan", "Busan"],
    ["taegu", "Daegu"],
    ["toei", "Tokyo"],
    // Kowloon is Hong Kong's, not "isn't in this ranking"; Tokyo's districts are real names, free.
    ["kowloon", "Hong Kong"],
    ["shinjuku", "unknown"],
  ])("metro-cities: %s -> %s", (guess, name) => {
    expect(lands("metro-cities", guess)).toBe(name);
  });

  it("metro-cities: Tokyo's fact says the ranking is Tokyo Metro alone (the judge, Nov 5)", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "metro-cities.json"), "utf8"));
    expect(p.answers.find((e) => e.name === "Tokyo")?.fact?.text).toMatch(/Toei/);
  });

  it("concert-tours: the artist's surname or first name alone, and names the page leaves out (coverage audit, Nov 13)", () => {
    // "swift" and "taylor" said they aren't in the ranking, with the Eras Tour #1; like "taylor swift", they put it in
    // the box to confirm (her 1989 World Tour has the names too).
    expect(lands("concert-tours", "swift")).toBe("The Eras Tour");
    expect(lands("concert-tours", "taylor")).toBe("The Eras Tour");
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "concert-tours.json"), "utf8"));
    for (const name of ["bono", "acdc", "oasis live 25"]) {
      expect(judgeGuess(name, p, new Set(), lex), name).toMatchObject({ kind: "unknown", known: true });
    }
  });

  it.each([
    // Coverage audit (Nov 13): Australia's short forms found nothing (shared COUNTRY_FORMS, applied at this build).
    ["aus", "Australia"],
    ["oz", "Australia"],
    // The judge (Nov 5): Antarctica is no country, like Greenland: free, not a costly miss with a top-10 figure.
    ["antarctica", "unknown"],
    ["greenland", "unknown"],
  ])("coastline-countries: %s -> %s", (guess, name) => {
    expect(lands("coastline-countries", guess)).toBe(name);
  });

  it("coastline-countries: Denmark's figure says it leaves out Greenland (the judge, Nov 5)", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "coastline-countries.json"), "utf8"));
    expect(p.extras.find((e) => e.name === "Denmark")?.value).toBe("7,314 km (without Greenland)");
    expect(p.extras.find((e) => e.name === "Antarctica")).toBeUndefined();
  });

  it("australia-cities: topic redirects are no names of the city (CITY_JUNK)", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "australia-cities.json"), "utf8"));
    const aliases = p.answers.flatMap((e) => e.aliases);
    for (const junk of ["Brisbane sport", "Brisbane Architecture", "Pinjar Park Speedway", "Central Coast Taxis"]) {
      expect(aliases).not.toContain(junk);
    }
  });

  // Coverage audit of the Nov 23 - Dec 6 candidates (Nov 17): each guess below found nothing, read as "not one of
  // the N here", or landed on the wrong entry before the fix noted with it.
  it.each([
    // "dakha" found nothing (shared CITY_FORMS).
    ["capitals", "dakha", "Dhaka"],
    // "the lion king live action" and "ne zha 1" found nothing.
    ["animated-films", "the lion king live action", "The Lion King (2019)"],
    ["animated-films", "live action lion king", "The Lion King (2019)"],
    ["animated-films", "ne zha 1", "Ne Zha"],
    // "merc", "beemer", "bimmer" and "lynk" found nothing; after the rebuild "volkswagen" offered the brand's own
    // article (a life) beside the group (car-makers `skip`).
    ["car-makers", "merc", "Mercedes-Benz"],
    ["car-makers", "beemer", "BMW"],
    ["car-makers", "bimmer", "BMW"],
    ["car-makers", "lynk", "Geely"],
    ["car-makers", "volkswagen", "Volkswagen Group"],
    // "aus" and "oz" said Australia (#9) isn't in the ranking (shared COUNTRY_FORMS, applied at this build).
    ["island-countries", "aus", "Australia"],
    ["island-countries", "oz", "Australia"],
    ["co2-emissions", "aus", "Australia"],
    // Owners' names that found nothing.
    ["dog-breeds", "dachsie", "Dachshund"],
    ["dog-breeds", "rotty", "Rottweiler"],
    ["dog-breeds", "teacup poodle", "Poodle"],
    ["dog-breeds", "amstaff", "American Staffordshire Terrier"],
    ["dog-breeds", "mini aussie", "Miniature American Shepherd"],
    // Fans' shorthand.
    ["netflix-seasons", "st4", "Stranger Things (Season 4)"],
    ["netflix-seasons", "st5", "Stranger Things (Season 5)"],
    ["youtube-videos", "temu ad", "Temu's Big Game Ad"],
    ["nfl-passing-yards", "johnny u", "Johnny Unitas"],
    ["market-cap-peak", "taiwan semi", "TSMC"],
    // The rebuild split out a by-year table's "Animal House" without its full title (read as free).
    ["us-box-office", "national lampoon's animal house", "Animal House"],
  ])("coverage audit, Nov 17: %s, %s -> %s", (id, guess, name) => {
    expect(lands(id, guess)).toBe(name);
  });

  it("coverage audit, Nov 17: well-known names the rankings leave out say so", () => {
    const known: [string, string[]][] = [
      ["capitals", ["ho chi minh", "ho chi minh city"]],
      ["dog-breeds", ["pit bulls", "pitbull terrier", "shepsky"]],
      // "rickroll" is Never Gonna Give You Up since it ranks by its views (owner, Nov 18: famous names count).
      ["youtube-videos", ["twinkle twinkle little star", "five little ducks", "finger family", "head shoulders knees and toes"]],
      ["nfl-passing-yards", ["jalen hurts", "michael vick", "jameis winston", "tua tagovailoa", "cj stroud", "trevor lawrence"]],
      ["market-cap-peak", ["palantir", "standard oil", "east india company", "anthropic", "bytedance"]],
    ];
    for (const [id, names] of known) {
      const p: Puzzle = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
      for (const name of names) expect(judgeGuess(name, p, new Set(), lex), `${id}: ${name}`).toMatchObject({ kind: "unknown", known: true });
    }
  });

  it("us-box-office: the franchise's name offers each of its films, The Fellowship of the Ring included (Nov 17)", () => {
    const r = judgeGuess("lord of the rings", JSON.parse(readFileSync(join(dir, "us-box-office.json"), "utf8")) as Puzzle, new Set(), lex);
    expect(r.kind === "typo" && r.suggestions).toContain("The Lord of the Rings: The Fellowship of the Ring");
  });

  it("car-makers: Tesla, the usual first miss, shows its 2025 deliveries; the title names the measure", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "car-makers.json"), "utf8"));
    expect(p.extras.filter((e) => /tesla/i.test(e.name)).map((e) => [e.name, e.value])).toEqual([["Tesla, Inc.", "1,636,129"]]);
    expect(p.title).toMatch(/sold the most vehicles/);
  });

  // Coverage audit of Today's lists for Nov 28, Dec 3 and Dec 4 (Nov 17): each guess below found nothing, said it
  // "isn't in this ranking", cost a life as an answer of its own, or reached its entry only through a correction,
  // before the fix noted with it.
  it.each([
    // A second "BMW 3 Series" key in scripts/intent.ts (Nov 8) replaced the first, so "bmw 3" was lost and "bmw 3
    // series" (read as "bmw 3") was a correction. The 3 Series' generations and the M3 found nothing.
    ["car-models", "bmw 3", "near BMW 3 Series"],
    ["car-models", "bmw 3 series", "near BMW 3 Series"],
    ["car-models", "e30", "near BMW 3 Series"],
    ["car-models", "m3", "near BMW 3 Series"],
    // Owners' and fans' names for the top 10.
    ["car-models", "ford pickup", "correct Ford F-Series"],
    ["car-models", "ford truck", "correct Ford F-Series"],
    ["car-models", "super duty", "correct Ford F-Series"],
    ["car-models", "gti", "correct Volkswagen Golf"],
    ["car-models", "civic type r", "correct Honda Civic"],
    ["car-models", "ae86", "correct Toyota Corolla"],
    // And for the pool's nameplates ("vauxhall corsa": the row is "Opel/Vauxhall").
    ["car-models", "chevy silverado", "near Chevrolet Silverado"],
    ["car-models", "honda crv", "near Honda CR-V"],
    ["car-models", "ram truck", "near Ram Pickup"],
    ["car-models", "vauxhall corsa", "near Opel Corsa"],
    ["car-models", "deux chevaux", "near Citroën 2CV"],
    ["car-models", "zhiguli", "near Lada Riva"],
    ["car-models", "trabi", "near Trabant 601"],
    ["car-models", "mazda 323", "near Mazda Familia"],
    ["car-models", "240z", "near Nissan Z-car"],
    ["car-models", "volvo 240", "near Volvo 200 Series"],
    ["car-models", "vw van", "near Volkswagen Type 2"],
    ["car-models", "lancer evo", "near Mitsubishi Lancer"],
    // A famous game typed for its series: a title that is a known name elsewhere said it isn't in the ranking (the
    // series at #1 to #10 included), others went to a confirm; sub-series the page counts in a series cost a life of
    // their own (topics.ts `skip`).
    ["game-franchises", "pokemon red", "correct Pokémon"],
    ["game-franchises", "pokemon scarlet", "correct Pokémon"],
    ["game-franchises", "pokemon mystery dungeon", "correct Pokémon"],
    ["game-franchises", "super mario odyssey", "correct Mario"],
    ["game-franchises", "paper mario", "correct Mario"],
    ["game-franchises", "new super mario bros", "correct Mario"],
    ["game-franchises", "luigi's mansion", "correct Mario"],
    ["game-franchises", "mario kart wii", "correct Mario"],
    ["game-franchises", "black ops", "correct Call of Duty"],
    ["game-franchises", "black ops 6", "correct Call of Duty"],
    ["game-franchises", "call of duty black ops", "correct Call of Duty"],
    ["game-franchises", "warzone", "correct Call of Duty"],
    ["game-franchises", "mw2", "correct Call of Duty"],
    ["game-franchises", "gta online", "correct Grand Theft Auto"],
    ["game-franchises", "gta san andreas", "correct Grand Theft Auto"],
    ["game-franchises", "minecraft java", "correct Minecraft"],
    ["game-franchises", "fc 25", "correct FIFA"],
    ["game-franchises", "fifa world cup", "correct FIFA"],
    ["game-franchises", "ac valhalla", "correct Assassin's Creed"],
    ["game-franchises", "assassins creed odyssey", "correct Assassin's Creed"],
    ["game-franchises", "resident evil village", "correct Resident Evil"],
    ["game-franchises", "ffxiv", "correct Final Fantasy"],
    ["game-franchises", "ff7 remake", "correct Final Fantasy"],
    ["game-franchises", "tetris the grand master", "correct Tetris"],
    // Near misses by their games and their fans' names.
    ["game-franchises", "breath of the wild", "near The Legend of Zelda"],
    ["game-franchises", "lara croft", "near Tomb Raider"],
    ["game-franchises", "spiderman", "near Marvel's Spider-Man"],
    ["game-franchises", "nfs", "near Need for Speed"],
    ["game-franchises", "metal gear solid", "near Metal Gear"],
  ])("coverage audit, Nov 17 (Nov 28 to Dec 4): %s, %s -> %s", (id, guess, want) => {
    const r = judgeGuess(guess, JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as Puzzle, new Set(), lex);
    expect("entry" in r ? `${r.kind}${"corrected" in r && r.corrected ? "?" : ""} ${r.entry.name}` : r.kind).toBe(want);
  });

  it("coverage audit, Nov 17 (Nov 28 to Dec 4): well-known names outside the rankings say so", () => {
    const known: [string, string[]][] = [
      // They read "not one of the athletes here"; the other Ronaldo is no Cristiano.
      ["athletes-earnings", ["mayweather", "verstappen", "scheffler", "vini jr", "de bruyne", "mike tyson", "ronaldo nazario", "lando norris", "dhoni"]],
      ["car-models", ["toyota tacoma", "honda odyssey", "nissan qashqai", "qashqai", "jeep grand cherokee", "range rover", "tesla model s", "new beetle"]],
      // "nintendo" put Nintendo Mini Classics (keychain LCD games) in the box.
      ["game-franchises", ["flappy bird", "undertale", "subway surfers", "nintendo"]],
    ];
    for (const [id, names] of known) {
      const p: Puzzle = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
      for (const name of names) expect(judgeGuess(name, p, new Set(), lex), `${id}: ${name}`).toMatchObject({ kind: "unknown", known: true });
    }
  });

  it("game-franchises: no answer is named for a top-10 series, so a sub-series never costs a life of its own (Nov 17)", () => {
    const p: Puzzle = JSON.parse(readFileSync(join(dir, "game-franchises.json"), "utf8"));
    const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const series = p.answers.map((a) => fold(a.name));
    // FIFA Manager is EA's management series, not FIFA's: its own.
    const own = new Set(["FIFA Manager"]);
    const named = p.extras.filter((e) => !own.has(e.name) && series.some((s) => fold(e.name).startsWith(`${s} `) || fold(e.name).startsWith(`${s}:`)));
    expect(named.map((e) => e.name)).toEqual([]);
  });

  describe("missed guesses, Nov 18", () => {
    // Launch night's wrong guesses the game didn't take (the live database): fair answers it refused on four free-play
    // lists, each read the natural way now. "?" is a correction put in the box to confirm; "choose" lists the choices.
    const read = (id: string, guess: string, found: number[] = []) => {
      const r = judgeGuess(guess, JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as Puzzle, new Set(found), lex);
      if ("entry" in r) return `${r.kind}${"corrected" in r && r.corrected ? "?" : ""} ${r.entry.name}`;
      return r.kind === "typo" ? `choose ${r.suggestions.join(" | ")}` : r.kind;
    };
    it.each([
      // A people's name is their empire (intent.ts).
      ["empires", "english", "correct British Empire"],
      ["empires", "japanese", "near Empire of Japan"],
      // A people with several empires: the most prominent few to choose from, as "avengers" offers its films. "arab" is
      // one alias on the four Arab caliphates (2-4 owners: kept on all); the Chinese dynasties are too many for one
      // alias, so they say they're China's (topics.ts `countries`) and the matcher offers a country's entries.
      ["empires", "arab", "choose Abbasid Caliphate | Fatimid Caliphate | Rashidun Caliphate | Umayyad Caliphate"],
      ["empires", "arabs", "choose Abbasid Caliphate | Fatimid Caliphate | Rashidun Caliphate | Umayyad Caliphate"],
      ["empires", "arab caliphate", "choose Abbasid Caliphate | Fatimid Caliphate | Rashidun Caliphate | Umayyad Caliphate"],
      ["empires", "chinese", "choose Eastern Han dynasty | Ming dynasty | Qing dynasty | Yuan dynasty"],
      ["empires", "china", "choose Eastern Han dynasty | Ming dynasty | Qing dynasty | Yuan dynasty"],
      // "natural history museum london" already landed; the same museum in other words.
      ["museums", "museum of natural history of london", "correct Natural History Museum, South Kensington"],
      ["museums", "museum of natural history london", "correct Natural History Museum, South Kensington"],
      ["museums", "london museum of natural history", "correct Natural History Museum, South Kensington"],
      ["museums", "natural history museum of london", "correct Natural History Museum, South Kensington"],
      // Without a city it could be New York's (#11) or the Smithsonian's (#17): still a choice.
      ["museums", "museum of natural history", "choose American Museum of Natural History | National Museum of Natural History"],
      // A number glued to the name ("xbox 1" already landed), fans' short forms, the models; the PlayStations did.
      ["consoles", "xbox1", "near Xbox One"],
      ["consoles", "xbox 1", "near Xbox One"],
      ["consoles", "xb1", "near Xbox One"],
      ["consoles", "xbone", "near Xbox One"],
      ["consoles", "xbox one x", "near Xbox One"],
      ["consoles", "ps1", "correct PlayStation"],
      ["consoles", "ps2", "correct PlayStation 2"],
      ["consoles", "ps3", "correct PlayStation 3"],
      ["consoles", "ps4", "correct PlayStation 4"],
      ["consoles", "ps5", "correct PlayStation 5"],
      ["consoles", "psp", "near PlayStation Portable"],
      ["consoles", "xbox360", "correct Xbox 360"],
      ["consoles", "switch 2", "near Nintendo Switch 2"],
      ["consoles", "switch2", "near Nintendo Switch 2"],
      ["consoles", "series s", "near Xbox Series X/S"],
      ["consoles", "xsx", "near Xbox Series X/S"],
      ["consoles", "2ds", "near Nintendo 3DS"],
      ["consoles", "meta quest 2", "near Quest 2"],
      // Kilimanjaro's Italian name.
      ["mountains", "kilimangiaro", "near Mount Kilimanjaro"],
    ])("%s: %s -> %s", (id, guess, want) => {
      expect(read(id, guess)).toBe(want);
    });
    it("empires: once the top 10's are found, a people's name offers the next ones", () => {
      expect(read("empires", "chinese", [4, 9])).toBe("choose Eastern Han dynasty | Ming dynasty | Tang dynasty | Western Han dynasty");
      expect(read("empires", "arab", [7, 8])).toBe("choose Fatimid Caliphate | Rashidun Caliphate");
    });
    it("empires: no people's name is one alias on more than four empires", () => {
      const p: Puzzle = JSON.parse(readFileSync(join(dir, "empires.json"), "utf8"));
      const owners = (alias: string) => [...p.answers, ...p.extras].filter((e) => e.aliases.some((a) => normalize(a) === alias)).length;
      expect(owners("chinese")).toBe(0);
      expect(owners("arab")).toBe(4);
    });
  });

  describe("Nov 20 candidates", () => {
    // What the builder found on the new lists for Dec 6-13: redirects that turned other words into answers, and the
    // forms players use for a series' parts, a team's past names and a country with no team.
    const read = (id: string, guess: string) => {
      const r = judgeGuess(guess, JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as Puzzle, new Set(), lex);
      if ("entry" in r) return `${r.kind}${"corrected" in r && r.corrected ? "?" : ""} ${r.entry.name}`;
      return r.kind === "typo" ? `choose ${r.suggestions.join(" | ")}` : r.kind;
    };
    it.each([
      // Redirects to the brand's article that are other things: "sonic" was Amazon, "the keyword" Google.
      ["brands", "sonic", "unknown"],
      ["brands", "the keyword", "unknown"],
      ["brands", "just do it", "unknown"],
      ["brands", "coke", "correct Coca-Cola"],
      ["brands", "mercedes", "correct Mercedes-Benz"],
      // Parent companies are not the ranked brands.
      ["brands", "meta", "unknown"],
      // Saturn's moon is no titanium; a symbol that is an English word is no element.
      ["elements-crust", "titan", "unknown"],
      ["elements-crust", "in", "unknown"],
      ["elements-crust", "fe", "correct Iron"],
      ["elements-crust", "aluminum", "correct Aluminium"],
      ["elements-crust", "sulphur", "near Sulfur"],
      // A film of the series is not the series; its parts are.
      ["film-series", "captain marvel", "unknown"],
      ["film-series", "harry potter", "correct Wizarding World"],
      ["film-series", "deadpool", "correct X-Men"],
      ["film-series", "lord of the rings", "near Middle-earth"],
      ["film-series", "dc", "choose Batman | DC Extended Universe"],
      // A team's past names; the United Kingdom has no team (its names offer the home nations, England first).
      ["world-cup-wins", "west germany", "correct Germany"],
      ["world-cup-wins", "ussr", "near Russia"],
      ["world-cup-wins", "czechoslovakia", "choose Czech Republic | Slovakia"],
      ["world-cup-wins", "uk", "correct? England"],
      ["world-cup-wins", "antarctica", "unknown"],
      // Parts of Denmark and Norway, colder than any country, are free on the sovereign list.
      ["coldest-countries", "greenland", "unknown"],
      ["coldest-countries", "svalbard", "unknown"],
    ])("%s: %s -> %s", (id, guess, want) => {
      expect(read(id, guess)).toBe(want);
    });
    const entry = (id: string, name: string) => {
      const p: Puzzle = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
      return [...p.answers, ...p.extras].find((e) => e.name === name);
    };
    it("elements-crust: a trace element's power of ten is no figure (radium read as 9 ppm, #40)", () => {
      for (const name of ["Radium", "Xenon", "Astatine", "Plutonium"]) {
        expect(entry("elements-crust", name)?.rank, name).toBe(0);
        expect(entry("elements-crust", name)?.value, name).toBe("a trace, under 0.0001 ppm");
      }
      expect(entry("elements-crust", "Krypton")?.value).toBe("0.0001 ppm");
    });
    it("coldest-countries: figures below zero rank first (Canada's −4.03 °C read as 4.03)", () => {
      expect(entry("coldest-countries", "Canada")).toMatchObject({ rank: 1, value: "−4.03 °C" });
      expect(entry("coldest-countries", "Russia")).toMatchObject({ rank: 2, value: "−3.79 °C" });
    });
    it("world-cup-wins and nuclear-countries: a country with none says why", () => {
      expect(entry("world-cup-wins", "Finland")?.value).toBe("never played at a World Cup");
      expect(entry("nuclear-countries", "Germany")?.value).toBe("none since its phase-out in 2023");
    });
  });
});

describe("the pipeline's hand-written tables", () => {
  // Nov 17: car-models in scripts/intent.ts gave "BMW 3 Series" and "Mercedes-Benz C-Class" twice from Nov 8. The second
  // key replaced the first without a word, so "bmw 3" was lost; oxlint's default only warns.
  it("give no key twice", () => {
    const root = join(import.meta.dirname, "..");
    const r = spawnSync(join(root, "node_modules", ".bin", "oxlint"), ["-A", "all", "-D", "no-dupe-keys", "scripts", "src"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/no-dupe-keys/);
    expect(r.status).toBe(0);
  });
});
