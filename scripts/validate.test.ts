import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Entry, Puzzle } from "../src/game/types";
import { UNIVERSES, whereIs } from "./gazetteer";
import { TOPICS, type Topic } from "./topics";
import {
  checkPuzzle,
  elsewhereErrors,
  FACTS_REQUIRED_FROM,
  factIssues,
  factsWithoutPlace,
  figureShare,
  missingNicknames,
  PLACES_NOUN,
  REGION_REQUIRED_FROM,
  regionGaps,
  undeclaredRegion,
} from "./validate";

const fact = { text: "A plain fact.", source: "https://en.wikipedia.org/wiki/Example" };

/** A minimal valid puzzle: ranks 1-10 with facts, ranks up to `ranked`, and `unranked` rank-0 answers (`values` with a figure). */
function puzzle(opts: { ranked?: number; unranked?: number; values?: number; asOf?: string } = {}): Puzzle {
  const { ranked = 10, unranked = 20, values = 5, asOf = FACTS_REQUIRED_FROM } = opts;
  const entry = (rank: number, name: string): Entry => ({ rank, name, aliases: [`${name} alias`], value: String(1000 - rank), n: 1000 - rank });
  const top = Array.from({ length: 10 }, (_, i) => ({ ...entry(i + 1, `Answer ${i + 1}`), fact }));
  const more = Array.from({ length: ranked - 10 }, (_, i) => entry(11 + i, `Answer ${11 + i}`));
  const rest = Array.from({ length: unranked }, (_, i): Entry => ({
    rank: 0,
    name: `Other ${i + 1}`,
    aliases: [],
    ...(i < values ? { value: `#${i + 1} in 2024` } : {}),
  }));
  return {
    id: "test-list",
    title: "Test list",
    prompt: "Name the 10 test things",
    noun: "things",
    category: "Oddball",
    source: { name: "Wikipedia: Test", url: "https://en.wikipedia.org/wiki/Test", asOf },
    answers: top,
    extras: [...more, ...rest],
  };
}

const errors = (p: Puzzle, topic?: Partial<Topic>) =>
  checkPuzzle(p, "test-list.json", topic as Topic | undefined)
    .filter((i) => i.level === "error")
    .map((i) => i.msg);
const warnings = (p: Puzzle, topic?: Partial<Topic>) =>
  checkPuzzle(p, "test-list.json", topic as Topic | undefined)
    .filter((i) => i.level === "warn")
    .map((i) => i.msg);

describe("validate: facts", () => {
  it("passes a list whose top 10 all have sourced facts", () => {
    expect(errors(puzzle())).toEqual([]);
  });

  it("fails a list built under the rule with a top-10 answer missing its fact", () => {
    const p = puzzle();
    delete p.answers[3].fact;
    expect(errors(p)).toEqual([expect.stringContaining("without a fact: #4 Answer 4")]);
  });

  it("only warns for a list built before the rule", () => {
    const p = puzzle({ asOf: "2026-10-30" });
    delete p.answers[3].fact;
    expect(errors(p)).toEqual([]);
    expect(warnings(p)).toContainEqual(expect.stringContaining("without a fact: #4 Answer 4"));
  });

  it("fails a fact with an em dash or without a source URL", () => {
    const p = puzzle();
    p.answers[0].fact = { text: "Big — really big.", source: "https://en.wikipedia.org/wiki/A" };
    p.answers[1].fact = { text: "No source.", source: "" };
    p.answers[2].fact = { text: "Not a URL.", source: "Wikipedia" };
    expect(errors(p)).toEqual([
      "#1 Answer 1: fact has an em dash",
      "#2 Answer 2: fact has no source URL",
      "#3 Answer 3: fact has no source URL",
    ]);
  });

  it("checks facts as written in scripts/facts too", () => {
    expect(factIssues('x.json "A"', { text: "Fine.", source: "https://en.wikipedia.org/wiki/A" })).toEqual([]);
    expect(factIssues('x.json "A"', { text: "A — B", source: "https://en.wikipedia.org/wiki/A" })).toEqual(['x.json "A": fact has an em dash']);
    expect(factIssues('x.json "A"', { text: "", source: undefined })).toEqual([
      'x.json "A": fact has no text',
      'x.json "A": fact has no source URL',
    ]);
  });

  it("fails a prompt with an em dash", () => {
    const p = puzzle();
    p.prompt = "Name the 10 things — all of them";
    expect(errors(p)).toContain("prompt has an em dash");
  });
});

describe("validate: figures for misses", () => {
  it("counts ranked answers and unranked ones with a figure", () => {
    expect(figureShare(puzzle({ ranked: 15, unranked: 8, values: 3 }))).toEqual({ ranked: 15, unranked: 8, withValue: 3 });
  });

  it("fails a short ranking whose unranked answers have no figure", () => {
    expect(errors(puzzle({ ranked: 10, unranked: 20, values: 0 }))).toEqual([expect.stringContaining("the ranking stops at 10")]);
    expect(errors(puzzle({ ranked: 25, unranked: 20, values: 0 }))).toEqual([expect.stringContaining("the ranking stops at 25")]);
  });

  it("passes when some unranked answers show a figure, the ranking is long, or the topic says why not", () => {
    expect(errors(puzzle({ ranked: 10, unranked: 20, values: 1 }))).toEqual([]);
    expect(errors(puzzle({ ranked: 26, unranked: 20, values: 0 }))).toEqual([]);
    expect(errors(puzzle({ ranked: 10, unranked: 0 }))).toEqual([]);
    const topic = { id: "test-list", category: "Oddball" as const, noFigures: "every other thing has none" };
    expect(errors(puzzle({ ranked: 10, unranked: 20, values: 0 }), topic)).toEqual([]);
  });
});

describe("validate: ranks past the top 10", () => {
  it("lets a tie share its rank, and nothing else", () => {
    const p = puzzle({ ranked: 14 });
    // #12 and #13 tie: both #12, then #14.
    Object.assign(p.extras[2], { rank: 12, n: p.extras[1].n });
    expect(errors(p)).toEqual([]);
    p.extras[2].n = 1;
    expect(errors(p)).toEqual([expect.stringContaining("extras rank jumps from 12 to 12")]);
  });

  it("flags a universe member that is a ranked answer under another name", () => {
    const p = puzzle();
    p.extras.push({ rank: 11, name: "Djibouti City", aliases: [] }, { rank: 0, name: "Djibouti", aliases: [] });
    expect(warnings(p, { id: "test-list", universe: "capitals" })).toContainEqual(
      expect.stringContaining('"Djibouti City" and unranked "Djibouti" may be the same answer'),
    );
  });
});

describe("validate: value formats", () => {
  it("fails a ranked figure missing the currency sign the others show", () => {
    const p = puzzle();
    for (const e of [...p.answers, ...p.extras]) if (e.rank) e.value = `$${e.value}`;
    expect(errors(p)).toEqual([]);
    p.answers[6].value = "940,300,000";
    expect(errors(p)).toEqual(['#7 Answer 7: value "940,300,000" lacks the currency sign the others show']);
  });
});

describe("validate: placeholder rows", () => {
  it("fails an answer that is a title not announced yet", () => {
    const p = puzzle();
    p.extras[0].name = "Untitled Peaky Blinders sequel series";
    p.extras[1].name = "Awaiting release";
    expect(errors(p)).toEqual([
      expect.stringContaining('"Untitled Peaky Blinders sequel series": a placeholder'),
      expect.stringContaining('"Awaiting release": a placeholder'),
    ]);
  });
});

describe("validate: team nicknames", () => {
  it("fails a team in the source table that its universe's nickname doesn't reach", () => {
    const teams = UNIVERSES["mlb-teams"]();
    const p = puzzle({ unranked: 0 });
    // Every team with its universe names, except the Cubs, named in full only (as the table writes them).
    p.extras.push(...teams.map((t, i): Entry => ({ rank: 11 + i, name: t.name, aliases: t.name === "Chicago Cubs" ? [] : [...t.aliases] })));
    const cubs = p.extras.find((e) => e.name === "Chicago Cubs")!;
    expect(missingNicknames(p, { universe: "mlb-teams" })).toEqual([`#${cubs.rank} Chicago Cubs: no "Cubs"`]);
    cubs.aliases.push("Cubs");
    expect(missingNicknames(p, { universe: "mlb-teams" })).toEqual([]);
  });

  it("holds on every team list as built", () => {
    const lists = TOPICS.filter((t) => [t.universe ?? []].flat().some((u) => /-teams$/.test(u)));
    expect(lists.length).toBeGreaterThan(0);
    for (const t of lists) {
      const built: Puzzle = JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "puzzles", `${t.id}.json`), "utf8"));
      expect(missingNicknames(built, t), t.id).toEqual([]);
    }
  });
});

describe("validate: regional lists", () => {
  const unranked = (...names: string[]): Entry[] => names.map((name) => ({ rank: 0, name, aliases: [] }));
  const elsewhere = (...names: string[]): Entry[] => names.map((name) => ({ rank: 0, name, aliases: [], elsewhere: true }));
  const europe = { region: "Europe", noun: "countries" };
  /** A European country list as the build makes it: every country plainly outside Europe marked elsewhere. */
  const europeList = () => {
    const p = puzzle({ unranked: 0 });
    p.noun = "countries";
    p.region = "Europe";
    p.extras.push(...elsewhere(...UNIVERSES.countries().filter((c) => whereIs(c.name, "Europe") === "outside").map((c) => c.name)));
    return p;
  };
  const without = (p: Puzzle, name: string) => ({ ...p, extras: p.extras.filter((e) => e.name !== name) });

  it("passes a regional country list whose places outside the region are marked elsewhere", () => {
    const p = europeList();
    // Vatican City is Europe's; Russia reaches Europe (free where the page leaves it out); Armenia is the page's row.
    p.extras.push(...unranked("Vatican City", "Russia"), { rank: 11, name: "Armenia", aliases: [] });
    expect(elsewhereErrors(p, europe)).toEqual([]);
    expect(regionGaps(p, europe)).toEqual([]);
  });

  it("fails a place outside the region that isn't marked elsewhere, or is missing (free)", () => {
    const p = europeList();
    const unmarked = without(p, "Japan");
    unmarked.extras.push(...unranked("Japan"));
    expect(regionGaps(unmarked, europe)).toEqual(['1 unranked place(s) outside Europe not marked elsewhere: "Japan" (Asia)']);
    expect(regionGaps(without(p, "Brazil"), europe)).toEqual(["1 place(s) outside Europe missing, so free instead of elsewhere: Brazil"]);
    expect(regionGaps({ ...p, region: undefined }, europe)).toEqual(['the puzzle says region nothing, the topic "Europe"']);
  });

  it("fails an elsewhere entry inside the region, on its debatable edge, ranked or with a figure", () => {
    const p = europeList();
    p.extras.push(...elsewhere("Portugal", "Turkey"), { rank: 0, name: "Holland", aliases: [], elsewhere: true, value: "17 million" });
    expect(elsewhereErrors(p, europe)).toEqual([
      '"Portugal" is marked elsewhere but is in Europe (Portugal)',
      '"Turkey" is marked elsewhere but is maybe in Europe (Türkiye)',
      '"Holland" is marked elsewhere but has a rank or a figure',
      '"Holland" is marked elsewhere but is in Europe (Netherlands)',
    ]);
    // Egypt is plainly outside Europe, but on Asia's debatable edge.
    expect(elsewhereErrors({ ...p, extras: elsewhere("Egypt"), region: "Asia" }, { region: "Asia", noun: "countries" })).toEqual([
      '"Egypt" is marked elsewhere but is maybe in Asia (Egypt)',
    ]);
  });

  it("fails elsewhere entries or a region on a list without one", () => {
    const p = puzzle();
    p.extras.push(...elsewhere("Japan"));
    p.region = "Europe";
    expect(elsewhereErrors(p, { noun: "countries" })).toEqual([
      'region "Europe" on a list whose topic has none',
      '1 entries marked elsewhere on a list with no region, e.g. "Japan"',
    ]);
  });

  it("checks a city list by the gazetteer's capitals and big cities, not its own namesakes", () => {
    const p = puzzle({ unranked: 0 });
    p.noun = "cities";
    p.region = "Europe";
    p.extras.push(...unranked("Tokyo", "Singapore", "Lisbon", "Leeds"), ...elsewhere("Mumbai", "Paris"));
    // Plymouth, England (with its figure from the list's own table), not Montserrat's capital.
    p.extras.push({ rank: 0, name: "Plymouth", aliases: [], value: "267,888", n: 267888 });
    const topic = { region: "Europe", noun: "cities" };
    expect(elsewhereErrors(p, topic)).toEqual(['"Paris" is marked elsewhere but is in Europe (France)']);
    expect(regionGaps(p, topic)[0]).toBe('2 unranked place(s) outside Europe not marked elsewhere: "Tokyo" (Japan), "Singapore" (Singapore)');
    expect(regionGaps(p, topic)[1]).toMatch(/^\d+ place\(s\) outside Europe missing, so free instead of elsewhere: Shanghai/);
  });

  it("only warns on a regional list built before the rule, until its rebuild", () => {
    const p = puzzle({ asOf: "2026-11-01" });
    p.noun = "countries";
    const topic = { id: "test-list", category: "Oddball" as const, ...europe };
    expect(errors(p, topic).filter((m) => /Europe/.test(m))).toEqual([]);
    expect(warnings(p, topic)).toContainEqual(expect.stringContaining("missing, so free instead of elsewhere"));
    p.source.asOf = REGION_REQUIRED_FROM;
    expect(errors(p, topic)).toContainEqual(expect.stringContaining("missing, so free instead of elsewhere"));
  });

  it("fails a field outside the puzzle format", () => {
    const p = puzzle();
    Object.assign(p.extras[0], { country: "Luxembourg" });
    expect(errors(p)).toEqual(['"Other 1": fields outside the puzzle format: country']);
  });

  it("fails a list of places whose title names a region it doesn't declare", () => {
    const base = { title: "Most populous African countries", prompt: "Name the 10 most populous countries in Africa", noun: "countries", page: "P" };
    expect(undeclaredRegion({ ...base, universe: "countries" })).toBe("African");
    expect(undeclaredRegion({ ...base, universe: "countries", region: "Africa" })).toBeUndefined();
    // Nothing beyond its own table: nothing can get in.
    expect(undeclaredRegion(base)).toBeUndefined();
    const china = { title: "Largest cities in mainland China", prompt: "Name the 10 most populous cities", noun: "cities", page: "P" };
    expect(undeclaredRegion({ ...china, also: [{ page: "World cities", tables: [0], name: "City" }] })).toBe("China");
    expect(undeclaredRegion({ ...china, also: [{ tables: [4], name: "City" }] })).toBeUndefined();
    expect(undeclaredRegion({ ...base, title: "Most populous countries", prompt: "Name the 10 most populous countries", universe: "countries" })).toBeUndefined();
  });

  it("holds on every topic and every regional list as built", () => {
    for (const t of TOPICS) expect(undeclaredRegion(t), t.id).toBeUndefined();
    const lists = TOPICS.filter((t) => t.region);
    expect(lists.map((t) => t.id)).toEqual(expect.arrayContaining(["africa-population", "asia-population", "europe-population", "europe-cities"]));
    for (const t of lists) {
      const built: Puzzle = JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "puzzles", `${t.id}.json`), "utf8"));
      expect(elsewhereErrors(built, t), t.id).toEqual([]);
      if (built.source.asOf >= REGION_REQUIRED_FROM) expect(regionGaps(built, t), t.id).toEqual([]);
    }
  });
});

describe("validate: facts on lists of places say where", () => {
  const withFacts = (...texts: string[]) => {
    const p = puzzle();
    texts.forEach((text, i) => (p.answers[i].fact = { text, source: fact.source }));
    p.answers = p.answers.slice(0, texts.length);
    return p;
  };

  it("flags a fact on a one-country list that names no state (owner: say the national park's state)", () => {
    const p = withFacts("Home to well over half of the world's geysers.", "In Utah, it was first protected in 1909.");
    expect(factsWithoutPlace(p, { placesIn: "United States" })).toEqual(["#1 Answer 1"]);
  });

  it("takes states, provinces and their spellings on one-country lists", () => {
    const us = withFacts(
      "In Washington state, it became a park in 1938.",
      "Spread over Wyoming, Montana and Idaho, it holds geysers.",
      "In New York City, the building has 94 stories.",
    );
    expect(factsWithoutPlace(us, { placesIn: "United States" })).toEqual([]);
    expect(factsWithoutPlace(withFacts("A planned city, capital of Goias state."), { placesIn: "Brazil" })).toEqual([]);
    expect(factsWithoutPlace(withFacts("A municipality with the rank of a province, it has a port."), { placesIn: "China" })).toEqual([]);
    // A country is not enough where the list is all one country.
    expect(factsWithoutPlace(withFacts("Brazil's first planned modern city."), { placesIn: "Brazil" })).toEqual(["#1 Answer 1"]);
  });

  it("takes a country, its usual form, a continent or a US state on a world list, not an adjective", () => {
    const ok = withFacts(
      "In the United Arab Emirates, it opened in 1960.",
      "Its control tower is shaped like a tulip, Turkey's national flower.",
      "In Ann Arbor, Michigan, every home game draws 100,000.",
      "In London, UK, it got 25,000 noise complaints.",
      "In Antarctica, meteorites keep well.",
      "On the Nepal–China border, it measured 29,000 ft.",
    );
    expect(factsWithoutPlace(ok, { placesIn: "world" })).toEqual([]);
    const bad = withFacts(
      "The Dutch Republic seized it in 1619.",
      "Contains Manitoulin Island, the largest freshwater island on Earth.",
      "During the Korean War the city changed hands four times.",
    );
    expect(factsWithoutPlace(bad, { placesIn: "world" })).toEqual(["#1 Answer 1", "#2 Answer 2", "#3 Answer 3"]);
  });

  it("takes the planet a moon orbits", () => {
    const p = withFacts("A moon of Jupiter, its surface is heavily cratered.", "Named after the king of the fairies.");
    expect(factsWithoutPlace(p, { placesIn: "planets" })).toEqual(["#2 Answer 2"]);
  });

  it("warns in checkPuzzle, and on a list of places that doesn't say placesIn", () => {
    const p = puzzle();
    p.noun = "lakes";
    p.answers[0].fact = { text: "Named after a king.", source: fact.source };
    const lakes = { id: "test-list", category: "Oddball" as const, noun: "lakes" };
    expect(warnings(p, { ...lakes, placesIn: "world" })).toContainEqual(expect.stringContaining("don't say where the place is"));
    expect(warnings(p, lakes)).toContainEqual(expect.stringContaining("set `placesIn`"));
    expect(errors(p, { ...lakes, placesIn: "world" })).toEqual([]);
  });

  it("holds on every list of places as built", () => {
    for (const t of TOPICS) if (PLACES_NOUN.test(t.noun)) expect(t.placesIn, `${t.id}: placesIn`).toBeDefined();
    const lists = TOPICS.filter((t) => t.placesIn);
    expect(lists.map((t) => t.id)).toEqual(expect.arrayContaining(["national-parks", "lakes", "us-cities", "moons", "stadiums"]));
    for (const t of lists) {
      const built: Puzzle = JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "puzzles", `${t.id}.json`), "utf8"));
      expect(factsWithoutPlace(built, t), t.id).toEqual([]);
    }
  });
});
