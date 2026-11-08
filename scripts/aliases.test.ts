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

  it("painters: Gauguin by ear, and no van Gogh guess turned into him", () => {
    expect(lands("painters", "gogan")).toBe("Paul Gauguin");
    expect(lands("painters", "gauguin")).toBe("Paul Gauguin");
    expect(lands("painters", "gogh")).toBe("Vincent van Gogh");
    expect(lands("painters", "van gogh")).toBe("Vincent van Gogh");
  });
});
