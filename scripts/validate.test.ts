import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Entry, Puzzle } from "../src/game/types";
import { UNIVERSES } from "./gazetteer";
import { TOPICS, type Topic } from "./topics";
import { checkPuzzle, FACTS_REQUIRED_FROM, factIssues, figureShare, missingNicknames, outsideRegion, undeclaredRegion } from "./validate";

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

  it("fails a regional country list whose pool holds another continent's countries (Japan on Europe)", () => {
    const p = puzzle({ unranked: 0 });
    p.noun = "countries";
    p.extras.push(...unranked("Japan", "Brazil", "Vatican City", "Russia"), { rank: 11, name: "Armenia", aliases: [] });
    // Vatican City is Europe's; Russia reaches Europe; a ranked row (Armenia) is the page's own scope.
    expect(outsideRegion(p, { region: "Europe", noun: "countries" })).toEqual(['"Japan" (Asia)', '"Brazil" (South America)']);
    expect(errors(p, { id: "test-list", noun: "countries", region: "Europe" })).toContain(
      '2 unranked answer(s) outside Europe, where guessing them should be free: "Japan" (Asia), "Brazil" (South America)',
    );
    expect(outsideRegion(p, { noun: "countries" })).toEqual([]);
  });

  it("knows a country by its other names", () => {
    const p = puzzle({ unranked: 0 });
    p.extras.push({ rank: 0, name: "Holland", aliases: [] }, { rank: 0, name: "Burma", aliases: ["Myanmar"] });
    expect(outsideRegion(p, { region: "Europe", noun: "countries" })).toEqual(['"Burma" (Asia)']);
  });

  it("fails a regional city list holding the world's capitals and big cities, not its own namesakes", () => {
    const p = puzzle({ unranked: 0 });
    p.extras.push(...unranked("Tokyo", "Mumbai", "Singapore", "Lisbon", "Luxembourg", "Leeds"));
    // Plymouth, England (with its figure from the list's own table), not Montserrat's capital.
    p.extras.push({ rank: 0, name: "Plymouth", aliases: [], value: "267,888", n: 267888 });
    expect(outsideRegion(p, { region: "Europe", noun: "cities" })).toEqual(['"Tokyo" (Japan)', '"Mumbai" (India)', '"Singapore" (Singapore)']);
    expect(outsideRegion(p, { region: "Asia", noun: "cities" })).toEqual(['"Lisbon" (Portugal)', '"Luxembourg" (Luxembourg)']);
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
      expect(outsideRegion(built, t), t.id).toEqual([]);
    }
  });
});
