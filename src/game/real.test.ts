// Checks against the built puzzle bank in public/puzzles.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Lexicon } from "./junk";
import { heldDebuts, localDate, rollHoldouts, type DailyEntry, type ListMeta } from "./daily";
import { judgeGuess } from "./match";
import type { Puzzle } from "./types";

const dir = join(import.meta.dirname, "../../public/puzzles");
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(dir, f), "utf8"));
/** A list's judge verdict (scripts/judge/verdicts), if it has one. */
const verdict = (id: string): { ownerVeto?: string; decision?: string; by?: string } | undefined => {
  try {
    return JSON.parse(readFileSync(join(import.meta.dirname, "../../scripts/judge/verdicts", `${id}.json`), "utf8"));
  } catch {
    return undefined;
  }
};
const lex = read<Lexicon>("lexicon.json");
const judge = (id: string, guess: string) => judgeGuess(guess, read<Puzzle>(`${id}.json`), new Set(), lex);

describe("built puzzles", () => {
  it("hedge funds: a firm-name word alone gives nothing away (the judge, Nov 7)", () => {
    for (const g of ["capital", "management", "asset management", "investment management", "associates", "technologies", "partners"]) {
      expect(judge("hedge-funds", g).kind, g).toBe("unknown");
    }
    expect(judge("hedge-funds", "bridgewater")).toMatchObject({ kind: "correct", entry: { name: expect.stringContaining("Bridgewater") } });
    expect(judge("hedge-funds", "aqr capital")).toMatchObject({ kind: "correct" });
    expect(judge("hedge-funds", "glg")).toMatchObject({ kind: "correct", entry: { name: "Man Group" } });
    expect(judge("hedge-funds", "2 sigma")).toMatchObject({ kind: "correct", entry: { name: "Two Sigma" } });
    expect(judge("hedge-funds", "renaissance tech")).toMatchObject({ kind: "correct", entry: { name: "Renaissance Technologies" } });
    expect(judge("hedge-funds", "two sigma ventures").kind).toBe("unknown");
  });

  it("video games: number-aware matching", () => {
    expect(judge("video-games", "gta5")).toMatchObject({ kind: "correct", entry: { name: "Grand Theft Auto V" } });
    expect(judge("video-games", "gta v")).toMatchObject({ kind: "correct", entry: { name: "Grand Theft Auto V" } });
    expect(judge("video-games", "gta 6").kind).not.toBe("correct");
    expect(judge("video-games", "grand theft auto").kind).not.toBe("near");
    expect(judge("video-games", "skyrim")).toMatchObject({ kind: "correct" });
  });

  it("countries: every country is an accepted answer, so wrong ones cost a life", () => {
    expect(judge("countries-area", "Austria")).toMatchObject({ kind: "near", entry: { name: "Austria" } });
    expect(judge("countries-population", "Fiji")).toMatchObject({ kind: "near" });
    expect(judge("countries-population", "Liechtenstein")).toMatchObject({ kind: "near" });
    expect(judge("countries-population", "Elon Musk").kind).toBe("unknown");
    expect(judge("countries-population", "asdf")).toMatchObject({ kind: "unknown", junk: true });
  });
});

describe("codes", () => {
  it("keyboard mash never fuzzy-matches an airport code", () => {
    expect(judge("airports", "asdf")).toMatchObject({ kind: "unknown", junk: true });
    expect(judge("airports", "ATL")).toMatchObject({ kind: "correct" });
  });
});

describe("first names and partial names", () => {
  it.each([
    ["wilt", "Wilt Chamberlain"],
    ["kareem", "Kareem Abdul-Jabbar"],
    ["dirk", "Dirk Nowitzki"],
    ["kobe", "Kobe Bryant"],
    ["kobe brynt", "Kobe Bryant"],
  ])("nba-points: %s -> %s", (guess, name) => {
    expect(judge("nba-points", guess)).toMatchObject({ kind: "correct", entry: { name } });
  });

  it("a shared name takes the natural reading: the famous one first, the other once he's found", () => {
    expect(judge("nba-points", "jordan")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Michael Jordan" } });
    const mj = read<Puzzle>("nba-points.json").answers.find((e) => e.name === "Michael Jordan")!.rank;
    expect(judgeGuess("jordan", read<Puzzle>("nba-points.json"), new Set([mj]))).toMatchObject({
      kind: "near",
      corrected: true,
      entry: { name: "DeAndre Jordan" },
    });
    const kevin = judge("nba-points", "kevin");
    if (kevin.kind === "typo") expect(kevin.suggestions.length).toBeLessThanOrEqual(4);
    else expect(kevin).toMatchObject({ corrected: true });
  });
});

describe("a franchise's name", () => {
  // Player's note: "monsters" filled in Monsters University (#10) when Monsters, Inc. (#14) is just as much "monsters".
  it("pixar-films: monsters offers Monsters University and Monsters, Inc.", () => {
    const r = judge("pixar-films", "monsters");
    expect(r.kind).toBe("typo");
    if (r.kind === "typo") expect(r.suggestions).toEqual(expect.arrayContaining(["Monsters University", "Monsters, Inc."]));
  });
});

describe("intent edge cases", () => {
  it("a misspelled first name fills its own entry, not a lookalike surname", () => {
    expect(judge("nba-points", "kareen")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Kareem Abdul-Jabbar" } });
  });
  it("the exact name of a ranked entry counts; an unranked one that others contain offers choices", () => {
    expect(judge("films-gross", "avatar")).toMatchObject({ kind: "correct", entry: { name: "Avatar" } });
    expect(judge("youtube-channels", "mrbeast")).toMatchObject({ kind: "correct", entry: { name: "MrBeast" } });
    const w = judge("video-games", "witcher");
    expect(w.kind).toBe("typo");
    if (w.kind === "typo") expect(w.suggestions).toContain("The Witcher 3: Wild Hunt");
  });
  it("spacing never matters", () => {
    // "spiderman" is the shared Spider-Man alias: three films, so it asks for more rather than listing them.
    const r = judge("films-gross", "spiderman");
    if (r.kind === "typo") expect(r.suggestions.every((s) => s.startsWith("Spider-Man"))).toBe(true);
    else expect(r).toMatchObject({ kind: "unknown", junk: false, vague: expect.any(Number) });
  });
  it("never lists more than two choices for a misspelling", () => {
    for (const g of ["kareem", "jams", "harde", "malon"]) {
      const r = judge("nba-points", g);
      if (r.kind === "typo") expect(r.suggestions.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("owner playtest cases", () => {
  it.each([
    ["islands", "UK", "Great Britain"],
    ["islands", "United Kingdom", "Great Britain"],
    ["islands", "Britain", "Great Britain"],
    ["olympic-medals", "USSR", "Soviet Union"],
    ["nba-points", "wilt", "Wilt Chamberlain"],
    ["nba-points", "kareem", "Kareem Abdul-Jabbar"],
  ])("%s: %s counts as %s", (id, guess, name) => {
    expect(judge(id, guess)).toMatchObject({ kind: "correct", entry: { name } });
  });

  it.each([
    ["islands", "Faroe Islands"],
    ["youtube-channels", "Smosh"],
  ])("%s: %s is an accepted answer", (id, guess) => {
    const r = judge(id, guess);
    if (r.kind === "typo") expect(r.suggestions).toContain(guess);
    else expect(r.kind).toBe("near");
  });

  it("islands: New Zealand offers both islands", () => {
    expect(judge("islands", "New Zealand")).toEqual({ kind: "typo", suggestions: ["North Island", "South Island"] });
  });
});

describe("picking a choice", () => {
  it("an exact unranked name counts when the longer names are unranked too (Matterhorn)", () => {
    expect(judge("mountains", "Matterhorn")).toMatchObject({ kind: "near", entry: { name: "Matterhorn" } });
  });
  it("a picked choice resolves to that entry", () => {
    const p = read<Puzzle>("video-games.json");
    const r = judgeGuess("witcher", p, new Set(), lex);
    expect(r.kind).toBe("typo");
    if (r.kind !== "typo") return;
    const pick = judgeGuess("The Witcher", p, new Set(), lex, r.suggestions);
    expect(pick).toMatchObject({ kind: "near", entry: { name: "The Witcher" } });
  });
});

describe("the daily schedule", () => {
  // Separate topics for Today's list and Today's Blitz started on Nov 2; earlier Blitz picks are frozen as they ran.
  const SEPARATE = "2026-11-02";
  const days = read<DailyEntry[]>("daily.json");
  const category = new Map(read<{ id: string; category: string }[]>("index.json").map((x) => [x.id, x.category]));
  it("runs Today's list once, from the day lists and Blitzes split; a Blitz again only 30 days after its last Blitz", () => {
    const seen = new Map<string, string>();
    const lastBlitz = new Map<string, string>();
    const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    for (const d of days) {
      if (d.date >= SEPARATE) {
        expect(seen.get(d.id), `${d.id} on ${d.date} already ran on ${seen.get(d.id)}`).toBeUndefined();
        expect(d.blitz, `${d.date}: the list is its own Blitz`).not.toBe(d.id);
        // A day doesn't wait for a new Blitz (owner, Nov 4): it may rerun a list in random play, in another category.
        const before = d.blitz && seen.get(d.blitz);
        if (d.blitz && before) {
          const last = lastBlitz.get(d.blitz);
          expect(!last || daysBetween(last, d.date) >= 30, `${d.blitz} on ${d.date} ran as a Blitz on ${last}`).toBe(true);
          expect(category.get(d.blitz), `${d.date}: Blitz rerun ${d.blitz} in the list's category`).not.toBe(category.get(d.id));
        }
      }
      for (const id of [d.id, d.blitz]) if (id && !seen.has(id)) seen.set(id, d.date);
      if (d.blitz) lastBlitz.set(d.blitz, d.date);
    }
    // A Blitz never spoils a later day's list.
    for (const d of days) {
      const later = days.find((x) => x.date > d.date && x.id === d.blitz);
      expect(later, `${d.blitz}: Blitz on ${d.date}, Today's list on ${later?.date}`).toBeUndefined();
    }
  });
  it("gives every day its own Blitz", () => {
    for (const d of days) expect(d.blitz, d.date).toBeTruthy();
  });
  // Nov 3-5 ran three Geography lists in a row (populations, parks, lakes); the owner swapped Nov 5 out.
  it("never runs Today's list from one category three days running, from Nov 3", () => {
    const recent = days.filter((d) => d.date >= "2026-11-03");
    for (let i = 2; i < recent.length; i++) {
      const [a, b, c] = recent.slice(i - 2, i + 1).map((d) => category.get(d.id));
      expect(a === b && b === c, `${recent[i - 2].date} to ${recent[i].date}: three ${c} lists`).toBe(false);
    }
  });
  it("never schedules a list the owner vetoed as a daily", () => {
    const vetoed = days.filter((d) => d.date >= "2026-11-05" && verdict(d.id)?.ownerVeto).map((d) => `${d.date} ${d.id}`);
    expect(vetoed).toEqual([]);
  });
});

describe("new lists debut as dailies", () => {
  // The owner's flow: a new list runs first as Today's list (or Blitz), and joins random play the day after.
  const days = read<DailyEntry[]>("daily.json");
  const index = read<ListMeta[]>("index.json");
  const debuts = index.filter((m) => m.debut);
  const first = (id: string) => days.filter((d) => d.id === id || d.blitz === id).map((d) => d.date).sort()[0];
  it("each new list is unscheduled, scheduled from today on, or has run; random play follows", () => {
    const today = localDate();
    for (const { id } of debuts) {
      const debut = first(id);
      const held = rollHoldouts(days, index, undefined, today).has(id);
      if (debut && debut < today) expect(heldDebuts(days, index, today).has(id), `${id} ran on ${debut}`).toBe(false);
      else expect(held, `${id} ${debut ? `debuts on ${debut}` : "has no day yet"}: held from random play`).toBe(true);
    }
  });
  it("no new list a judge sent to free play waits for a day that never comes", () => {
    // Drop `debut` in topics.ts for a list no daily will take (scripts/schedule.ts lists them).
    const judged = (id: string) => (verdict(id)?.by === "builder" ? undefined : verdict(id)?.decision);
    const stuck = debuts.filter(({ id }) => !first(id) && ["free-play", "reject"].includes(judged(id) ?? "")).map((m) => m.id);
    expect(stuck).toEqual([]);
  });
});

// The coverage audit (Nov 8) played all 112 lists before launch. A guess lands on an entry (corrected or not), is
// offered among choices, or neither.
const lands = (id: string, guess: string): string[] => {
  const r = judge(id, guess);
  return r.kind === "typo" ? r.suggestions : "entry" in r ? [r.entry.name] : [];
};

describe("coverage audit: matching rules", () => {
  it("a real name that isn't an answer says so (hedge-funds: Point72)", () => {
    for (const [id, g] of [["hedge-funds", "Point72"], ["hedge-funds", "Jane Street"], ["netflix-seasons", "ozark"], ["skyscraper-cities", "manila"]]) {
      const r = judge(id, g);
      // Free and plain ("Point72 isn't in this ranking."), or an answer once the data takes it in.
      if (r.kind === "unknown") expect(r, `${id}: ${g}`).toMatchObject({ junk: false, known: true });
      else expect(r.kind, `${id}: ${g}`).toBe("near");
    }
  });

  it.each([
    ["countries-population", "afganistan", "Afghanistan"],
    ["countries-population", "irland", "Ireland"],
    ["countries-population", "guatamala", "Guatemala"],
    ["countries-area", "afganistan", "Afghanistan"],
    ["countries-gdp", "irland", "Ireland"],
    ["olympic-medals", "afganistan", "Afghanistan"],
    ["countries-population", "columbia", "Colombia"],
    ["rivers", "missisippi", "Mississippi"],
    ["rivers", "mississipi", "Mississippi"],
    ["rivers", "missisipi", "Mississippi"],
  ])("%s: a misspelling stored as an alias elsewhere, %s, still finds %s", (id, guess, name) => {
    expect(lands(id, guess)).toEqual([name]);
  });

  it.each([
    ["farm-products", "hay", "Pork"],
    ["landlocked-countries", "car", "Czech Republic"],
    ["websites", "snapchat", "Stripchat"],
    ["websites", "snapchat", "ShareChat"],
    ["websites", "snap chat", "ShareChat"],
    ["premier-league-goals", "fernando torres", "Fernando"],
    ["spotify-songs", "seven nation army", "Seven"],
    ["europe-cities", "praha", "Praia"],
    ["athletes-earnings", "alcaraz", "Canelo Álvarez"],
    ["retailers", "kmart", "Walmart"],
    ["us-surnames", "johnston", "Johnson"],
    ["us-surnames", "harrison", "Harris"],
    ["us-surnames", "cohen", "Chen"],
    ["us-surnames", "muller", "Miller"],
    ["boys-names", "jeremy", "Jeffrey"],
    ["girls-names", "christina", "Christine"],
    ["girls-names", "marie", "Maria"],
    ["video-games", "mario kart ds", "Mario Kart 8"],
    ["video-games", "modern warfare 2", "Call of Duty: Modern Warfare"],
    ["car-models", "vw bus", "Volkswagen Beetle"],
    ["car-makers", "gac motor", "General Motors"],
  ])("%s: %s is never %s", (id, guess, name) => {
    expect(lands(id, guess)).not.toContain(name);
  });

  it.each([
    ["super-bowl-wins", "pass"],
    ["nfl-rushing-yards", "dunno"],
    ["mlb-home-runs", "dunno"],
    ["europe-cities", "dunno"],
    ["companies-revenue", "no idea"],
    ["countries-population", "idk"],
  ])("%s: giving up (%s) is free and never an answer", (id, guess) => {
    expect(judge(id, guess)).toEqual({ kind: "unknown", junk: false, giveUp: true });
  });

  it.each([
    ["fast-food-chains", "pizza"],
    ["fast-food-chains", "coffee"],
    ["fast-food-chains", "burgers"],
    ["sports-leagues", "football"],
    ["sports-leagues", "basketball"],
    ["sports-leagues", "baseball"],
    ["sports-leagues", "hockey"],
    ["sports-leagues", "rugby"],
    ["farm-products", "meat"],
    ["farm-products", "fruit"],
  ])("%s: the category word %s asks for more", (id, guess) => {
    expect(judge(id, guess)).toMatchObject({ kind: "unknown", vague: expect.any(Number) });
  });

  it.each([
    ["mountains", "mt fuji", "Mount Fuji"],
    ["mountains", "mt. kilimanjaro", "Mount Kilimanjaro"],
    ["national-parks", "mt rainier", "Mount Rainier"],
    ["super-bowl-wins", "la rams", "Los Angeles Rams"],
    ["super-bowl-wins", "ny jets", "New York Jets"],
    ["super-bowl-wins", "sf niners", "San Francisco 49ers"],
    ["world-series-wins", "tb rays", "Tampa Bay Rays"],
    ["world-series-wins", "chi sox", "Chicago White Sox"],
    ["stadiums", "texas am", "Kyle Field"],
    ["longest-running-tv", "law n order", "Law & Order"],
    ["game-franchises", "sims 4", "The Sims"],
    ["game-franchises", "fifa 23", "FIFA"],
    ["game-franchises", "tetris 99", "Tetris"],
    ["us-metros", "saint louis", "St. Louis"],
    ["albums", "the fame", "The Fame / The Fame Monster"],
    ["youtube-videos", "baby shark song", "Baby Shark Dance"],
  ])("%s: the short form %s is %s", (id, guess, name) => {
    expect(lands(id, guess)).toEqual([name]);
  });

  it("nba-assists: Isaiah Thomas offers Isiah Thomas (#10) too", () => {
    expect(lands("nba-assists", "isaiah thomas")).toEqual(["Isaiah Thomas", "Isiah Thomas"]);
  });

  it.each([
    ["media-franchises", "tmnt"],
    ["game-franchises", "csgo"],
    ["websites", "4chan"],
    ["websites", "9gag"],
    ["websites", "bbc.co.uk"],
    ["music-artists", "6ix9ine"],
    ["retailers", "tj maxx"],
    ["retailers", "tk maxx"],
    ["car-models", "rav4"],
    ["market-cap-peak", "asml"],
    ["manga", "bnha"],
    ["manga", "fmab"],
    ["youtube-channels", "mkbhd"],
    ["national-parks", "statue of liberty"],
    ["buildings", "tokyo skytree"],
    ["albums", "4"],
    ["youtube-videos", "hello"],
    ["albums", "help"],
    ["longest-running-tv", "himym"],
    ["sports-leagues", "lpga"],
  ])("%s: %s is a real name, never junk", (id, guess) => {
    const r = judge(id, guess);
    expect(r.kind === "unknown" && r.junk).toBe(false);
  });
});

describe("every built list", () => {
  const index = read<{ id: string }[]>("index.json");
  // Typing what the list is about ("tour", "songs", "car") must never hand over a top-10 answer.
  it("never offers a top-10 answer for its own noun", () => {
    const leaks: string[] = [];
    for (const { id } of index) {
      const p = read<Puzzle>(`${id}.json`);
      const top = new Set(p.answers.map((a) => a.name));
      const words = p.noun.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      for (const g of new Set([p.noun.toLowerCase(), ...words, ...words.map((w) => w.replace(/(e?s)$/, ""))])) {
        const r = judgeGuess(g, p, new Set(), lex);
        // An answer named exactly that is fine: the Instagram account on Instagram accounts.
        const given = r.kind === "typo" ? r.suggestions.filter((s) => top.has(s)) : r.kind === "correct" && r.corrected ? [r.entry.name] : [];
        if (given.length) leaks.push(`${id}: "${g}" -> ${given.join(", ")}`);
      }
    }
    expect(leaks).toEqual([]);
  }, 30_000);
});
