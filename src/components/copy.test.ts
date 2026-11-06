import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entryPoints } from "../game/blitz";
import { shownValue } from "../game/state";
import type { Entry, Puzzle } from "../game/types";
import {
  alreadyGuessed,
  BLITZ_SCORING,
  blitzPrompt,
  blitzPromptShown,
  confirmGuess,
  GUESS_HINT,
  LIFE_LOST,
  lifeCostLine,
  metricLabel,
  NO_LIFE_LOST,
  notOnList,
} from "./copy";

const NBSP = String.fromCharCode(160);
const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ rank: i + 1, name: `e${i}`, aliases: [] }));
/** Ordinary spaces in place of the non-breaking ones, to read the copy. */
const plain = (s: string) => s.split(NBSP).join(" ");

const dir = join(import.meta.dirname, "../../public/puzzles");
const read = (id: string): Puzzle => JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
/** Every built list. */
const bank: Puzzle[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
  .filter((p) => Array.isArray(p?.answers));
const entry = (p: Puzzle, name: string): Entry => {
  const e = [...p.answers, ...p.extras].find((x) => x.name === name);
  if (!e) throw new Error(`${p.id}: no ${name}`);
  return e;
};
const miss = (id: string, name: string) => {
  const p = read(id);
  return plain(lifeCostLine(entry(p, name), p));
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("miss copy", () => {
  it("says how many of what are on the list when the puzzle names its noun", () => {
    expect(plain(notOnList({ noun: "films", answers: entries(10), extras: entries(227) }))).toBe("Not one of the 237 films here.");
    expect(plain(notOnList({ noun: "YouTube channels", answers: entries(10), extras: entries(3645) }))).toBe(
      "Not one of the 3,655 YouTube channels here.",
    );
  });
  it("falls back without a noun", () => {
    expect(notOnList({ answers: entries(10), extras: entries(5) })).toBe("Not on this list.");
  });
  it("keeps the noun's last word with its 'here.', and 'No life lost.' in one piece", () => {
    expect(notOnList({ noun: "NBA players", answers: entries(10), extras: [] })).toContain(`players${NBSP}here.`);
    expect(NO_LIFE_LOST).toBe(["No", "life", "lost."].join(NBSP));
  });
});

// Launch audit (Nov 6): "tokyo" read "Tokyo is #11, 200. So close.", "mets" "New York Mets is #15, 2. So close.", and
// "sao paulo" "São Paulo is outside the top 60.": a life gone, and nothing said it, and a bare number. Every line that
// costs a life ends "Lost a life.", and its number says what it counts.
describe("a miss that costs a life", () => {
  it("says what its number is, and that it cost a life", () => {
    expect(miss("skyscraper-cities", "Tokyo")).toBe("Tokyo is #11 with 200 skyscrapers. Lost a life.");
    expect(miss("world-series-wins", "New York Mets")).toBe("New York Mets is #15 with 2 World Series titles. Lost a life.");
    expect(miss("skyscraper-cities", "São Paulo")).toBe("São Paulo is outside the top 60. Lost a life.");
    expect(LIFE_LOST).toBe(["Lost", "a", "life."].join(NBSP));
  });
  it("reads naturally across kinds of lists", () => {
    // Counts: "with" the number and what it counts, the list's scale folded in, one of a thing singular.
    expect(miss("nobel-countries", "Netherlands")).toBe("Netherlands is #11 with 22 Nobel laureates. Lost a life.");
    expect(miss("ballon-dor-countries", "Bulgaria")).toBe("Bulgaria is #11 with 1 Ballon d'Or win. Lost a life.");
    expect(miss("albums", "Led Zeppelin IV")).toBe("Led Zeppelin IV is #11 with 37 million copies sold. Lost a life.");
    expect(miss("instagram", "Nike")).toBe("Nike is #11 with 290 million followers. Lost a life.");
    expect(miss("nhl-goals", "Mario Lemieux")).toBe("Mario Lemieux is #11 with 690 goals. Lost a life.");
    expect(miss("population-density", "Sint Maarten")).toBe("Sint Maarten is #11 with 1,275 people per km². Lost a life.");
    expect(miss("longest-running-tv", "Bob's Burgers")).toBe("Bob's Burgers is #11 with 16 seasons. Lost a life.");
    expect(miss("beer-per-capita", "Estonia")).toBe("Estonia is #11 with 80.5 L per person per year. Lost a life.");
    // Money says what it is by its currency.
    expect(miss("films-gross", "The Odyssey")).toBe("The Odyssey is #11 with $1,796,044,383. Lost a life.");
    expect(miss("banks", "Mitsubishi UFJ Financial Group")).toBe("Mitsubishi UFJ Financial Group is #11 with $2,666.71 billion. Lost a life.");
    expect(miss("countries-gdp", "Canada")).toBe("Canada is #11 with $2,490,256 million. Lost a life.");
    // Anything else names its column.
    expect(miss("countries-population", "Japan")).toBe("Japan is #11 (population: 122,690,000). Lost a life.");
    expect(miss("mountains", "Gasherbrum I")).toBe("Gasherbrum I is #11 (height: 8,080 m). Lost a life.");
    expect(miss("stadiums", "Melbourne Cricket Ground")).toBe("Melbourne Cricket Ground is #11 (capacity: 100,024). Lost a life.");
  });
  it("unranked answers: outside the ranking, with their figure, or where they ranked before", () => {
    expect(miss("nba-points", "John Stockton")).toBe("John Stockton is outside the top 50, with 19,711 points. Lost a life.");
    expect(miss("lakes", "Lake Tahoe")).toBe("Lake Tahoe is outside the top 47 (area: 490 km²). Lost a life.");
    expect(miss("airports", "Newark Liberty International Airport")).toBe(
      "Newark Liberty International Airport is outside the top 50, with 47,000,085 passengers (2025). Lost a life.",
    );
    expect(miss("car-models", "Ford Model T")).toBe("Ford Model T isn't in the top 10, with 16,500,000 units sold. Lost a life.");
    expect(miss("dog-breeds", "Pembroke Welsh Corgi")).toBe("Pembroke Welsh Corgi was #10 in 2019. Lost a life.");
    expect(miss("athletes-earnings", "Tyson Fury")).toBe("Tyson Fury was #3 in 2025 ($146 million). Lost a life.");
    expect(miss("car-makers", "Renault")).toBe("Renault was #9 in 2020 (2,949,871 vehicles sold). Lost a life.");
    expect(miss("city-visitors", "New York City")).toBe("New York City was #8 in 2023 (11.7 million arrivals). Lost a life.");
  });
  it("a place outside a regional list's region says so, and that it cost a life", () => {
    const p = read("europe-cities");
    const tokyo: Entry = { rank: 0, name: "Tokyo", aliases: [], elsewhere: true };
    expect(plain(lifeCostLine(tokyo, p))).toBe(`Tokyo isn't in ${p.region}. Lost a life.`);
  });
  it("on every built list: every miss ends 'Lost a life.', and no figure stands bare", () => {
    const bad: string[] = [];
    for (const p of bank) {
      // Every ranked miss and every unranked one with a figure; of the rest (one wording, and thousands of them on the
      // country lists), the first 20.
      const plainUnranked = p.extras.filter((e) => !e.rank && !e.value).slice(0, 20);
      for (const e of [...p.extras.filter((x) => x.rank || x.value), ...plainUnranked]) {
        const line = plain(lifeCostLine(e, p));
        const v = shownValue(e);
        // A plain number ("200", "2") always has a word after it or a column's name before it.
        const bare = !!v && /^[\d.,–-]+$/.test(v) && !new RegExp(`(: |[$€£])${esc(v)}|${esc(v)} \\p{L}`, "u").test(line);
        if (!/ Lost a life\.$/.test(line) || /#\d+, /.test(line) || bare) bad.push(`${p.id}: ${line}`);
      }
    }
    expect(bad).toEqual([]);
    // About 13,000 lines: a second or two alone, more beside the other test files.
  }, 30_000);
});

describe("metric names mid-sentence", () => {
  it("lowercase their first letter, unless it's an acronym or a name", () => {
    expect(metricLabel("Length")).toBe("length");
    expect(metricLabel("Skyscrapers (150 m+)")).toBe("skyscrapers (150 m+)");
    expect(metricLabel("Population (UN 2025)")).toBe("population (UN 2025)");
    expect(metricLabel("Million tonnes CO2 (2023)")).toBe("million tonnes CO2 (2023)");
    expect(metricLabel("Coastline (CIA World Factbook)")).toBe("coastline (CIA World Factbook)");
    for (const kept of [
      "GDP (US$ millions)",
      "US box office (US$)",
      "AKC rank (registrations, 2025)",
      "Nobel laureates",
      "Similarweb rank",
      "World Series titles",
      "Ballon d'Or wins",
      "Grand Prix wins",
      "Super Bowl wins",
      "Premier League goals",
      "World Heritage Sites",
      "McDonald's restaurants",
    ])
      expect(metricLabel(kept)).toBe(kept);
  });
  it("every built list's metric changes at most its first letter", () => {
    for (const p of bank) {
      if (!p.metric) continue;
      const m = metricLabel(p.metric);
      expect(m.slice(1), p.id).toBe(p.metric.slice(1));
    }
  });
});

describe("guess copy", () => {
  it("never names a key a phone doesn't have", () => {
    for (const s of [GUESS_HINT, confirmGuess("Poland")]) expect(s).not.toMatch(/enter/i);
  });
  // Launch audit (Nov 6): "Did you mean Dubai? Guess again to confirm." wrapped at 390 and grew the dock.
  it("the typo confirm is short, its instruction in one piece", () => {
    expect(plain(confirmGuess("Dubai"))).toBe("Dubai? Guess again to confirm.");
    expect(confirmGuess("Dubai")).toContain(["Guess", "again", "to", "confirm."].join(NBSP));
  });
  it("every feedback line ends with a full stop", () => {
    expect(alreadyGuessed("Hong Kong")).toBe("Already guessed Hong Kong.");
  });
});

describe("Blitz title card", () => {
  it("drops the top-10 cap from the list's prompt", () => {
    expect(blitzPrompt("Name the 10 most populous countries in the world")).toBe("Name the most populous countries in the world");
    expect(blitzPrompt("Something else")).toBe("Something else");
  });
  // Launch audit (Nov 6): the card said the same thing three times (title, prompt, "name as many countries as you can").
  it("shows the prompt only when it adds words beyond the title", () => {
    expect(blitzPromptShown("Countries with the most Nobel laureates", "Name the 10 countries with the most Nobel laureates")).toBeUndefined();
    expect(blitzPromptShown("Most populous countries", "Name the 10 most populous countries in the world")).toBeUndefined();
    expect(blitzPromptShown("Best-selling video games", "Name the 10 best-selling video games of all time")).toBeUndefined();
    expect(blitzPromptShown("Busiest airports", "Name the 10 busiest airports in the world by passenger traffic (2025)")).toBe(
      "Name the busiest airports in the world by passenger traffic (2025)",
    );
  });
  // Launch audit (Nov 6), UX 21: "scored by Nobel laureates: bigger is better" gave no yardstick (426 laureates scored
  // +100, 22 scored +39). The rule says what the scores do, and every Blitz list agrees with it.
  it("states the scoring rule plainly", () => {
    expect(BLITZ_SCORING).toBe("#1 gets 100, smaller numbers get less, down to 10.");
  });
  it("the rule agrees with the scores on every Blitz list", () => {
    for (const p of bank.filter((x) => x.blitz)) {
      const scored = [...p.answers, ...p.extras].filter((e) => e.n !== undefined && !e.elsewhere);
      const pts = scored.map((e) => ({ n: e.n!, pts: entryPoints(p, e) })).sort((a, b) => b.n - a.n);
      expect(entryPoints(p, p.answers[0]), `${p.id}: #1`).toBe(100);
      expect(Math.min(...pts.map((x) => x.pts)), p.id).toBeGreaterThanOrEqual(10);
      const up = pts.findIndex((x, i) => i > 0 && x.pts > pts[i - 1].pts);
      expect(up, `${p.id}: a smaller number scores more`).toBe(-1);
    }
  });
});
