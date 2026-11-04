import * as cheerio from "cheerio";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Puzzle } from "../src/game/types";
import {
  datedLabel,
  datedValue,
  labelYear,
  lastYear,
  lowerParts,
  matchFacts,
  mergeIndex,
  qualifiedLink,
  rangeText,
  rankedSources,
  rankOf,
  rankRows,
  readFacts,
  regionalNamesake,
  regionColumn,
  sameKey,
  scaledFigure,
  skipName,
} from "./build";
import { inRegion, UNIVERSES, whereIs } from "./gazetteer";
import { COUNTRY_FORMS } from "./intent";

describe("regional lists", () => {
  it("keep a country to its continent, and a transcontinental one to where the page lists it", () => {
    expect(inRegion("Japan", "Europe")).toBe(false);
    expect(inRegion("Vatican City", "Europe")).toBe(true);
    expect(inRegion("Czech Republic", "Europe")).toBe(true);
    // Denmark reaches North America only by Greenland, listed apart: Copenhagen is Europe's.
    expect(inRegion("Denmark", "Europe")).toBe(true);
    // A breakaway state counts under its de jure country: Tiraspol (Transnistria) is Moldova's.
    expect(inRegion("Transnistria", "Europe")).toBe(true);
    expect(inRegion("Brazil", "Africa")).toBe(false);
    // Egypt is free on the Asian list, whose table leaves it out; Turkey counts on Europe where the table lists it.
    expect(inRegion("Egypt", "Asia")).toBe(false);
    expect(inRegion("Turkey", "Europe")).toBe(false);
    expect(inRegion("Turkey", "Europe", new Set(["Türkiye"]))).toBe(true);
    expect(inRegion("China", "China")).toBe(true);
    expect(inRegion("India", "China")).toBe(false);
    expect(inRegion("Atlantis", "Europe")).toBeUndefined();
  });

  it("keep the capitals universe to the region's capitals", () => {
    const europe = UNIVERSES.capitals().filter((c) => inRegion(c.country!, "Europe"));
    expect(europe.map((c) => c.name)).toEqual(expect.arrayContaining(["Lisbon", "Vatican City", "Kyiv"]));
    expect(europe.map((c) => c.name)).not.toEqual(expect.arrayContaining(["Tokyo"]));
    expect(europe.map((c) => c.name)).not.toContain("Ankara");
  });

  it("place another page's rows by its country or its Country column, and fail a table that says neither", () => {
    const topic = { id: "europe-cities", page: "Europe page", region: "Europe" };
    const header = ["City", "Country", "Population"];
    expect(regionColumn(topic, { page: "World page" }, header, 0)).toBe(1);
    expect(regionColumn(topic, { page: "EU page" }, ["City", "Member state"], 0)).toBe(1);
    expect(regionColumn(topic, { page: "UK page", country: "United Kingdom" }, ["City"], 0)).toBe("inside");
    // Every US city is elsewhere; a transcontinental country's table gives nothing (free).
    expect(regionColumn(topic, { page: "US page", country: "United States" }, ["City"], 0)).toBe("outside");
    expect(regionColumn(topic, { page: "Turkey page", country: "Turkey" }, ["City"], 0)).toBe("unsure");
    // The topic's own page is its scope; a list without a region takes everything.
    expect(regionColumn(topic, {}, ["City"], 0)).toBe("inside");
    expect(regionColumn({ ...topic, region: undefined }, { page: "World page" }, ["City"], 0)).toBe("inside");
    expect(() => regionColumn(topic, { page: "World page" }, ["City", "Population"], 0)).toThrow(/says no country/);
  });

  it("put a country inside, outside, or on the region's debatable edge", () => {
    expect(whereIs("Japan", "Europe")).toBe("outside");
    expect(whereIs("Portugal", "Europe")).toBe("inside");
    // Egypt reaches Asia: free on the Asian list that leaves it out, a row where a page lists it, plainly not Europe.
    expect(whereIs("Egypt", "Asia")).toBe("unsure");
    expect(whereIs("Egypt", "Asia", new Set(["Egypt"]))).toBe("inside");
    expect(whereIs("Egypt", "Europe")).toBe("outside");
    expect(whereIs("Turkey", "Africa")).toBe("outside");
    expect(whereIs("Atlantis", "Europe")).toBeUndefined();
  });

  it("look up the bare name of a place whose table links it with a qualifier", () => {
    expect(qualifiedLink("Toledo", "Toledo, Ohio")).toBe(true);
    expect(qualifiedLink("Kingston", "Kingston, Jamaica")).toBe(true);
    expect(qualifiedLink("Valencia", "Valencia (Venezuela)")).toBe(true);
    expect(qualifiedLink("Tokyo", "Tokyo")).toBe(false);
    expect(qualifiedLink("Washington, D.C.", "Washington, D.C.")).toBe(false);
    // The same name punctuated otherwise, another name, or a red link: nothing to look up.
    expect(qualifiedLink("Washington D.C.", "Washington, D.C.")).toBe(false);
    expect(qualifiedLink("Wanzhou District", "Wanzhou, Chongqing")).toBe(false);
    expect(qualifiedLink("Bengaluru", "Bangalore")).toBe(false);
    expect(qualifiedLink("Fuping", "Fuping Town (page does not exist)")).toBe(false);
  });

  it("leave free a place outside the region only when Wikipedia gives its name to a place inside it", () => {
    const disambiguation = (body: string) =>
      cheerio.load(`<div class="mw-parser-output"><div id="disambigbox"></div>${body}</div><div id="catlinks">Disambiguation pages</div>`);
    const item = (title: string, line = title) => `<li><a title="${title}">${title}</a>${line.slice(title.length)}</li>`;
    // Toledo, Ohio is free on European cities (Toledo, Spain); Phoenix, Arizona costs a life.
    const toledo = disambiguation(`<ul>${item("Toledo, Spain", "Toledo, Spain, a city in Spain")}${item("Toledo, Ohio")}</ul>`);
    expect(regionalNamesake(toledo, "Toledo", "Europe")).toBe(true);
    expect(regionalNamesake(toledo, "Toledo", "Asia")).toBe(false);
    const phoenix = disambiguation(
      `<ul>${item("Phoenix, Arizona")}${item("Phoenix (mythology)")}<li><a title="The Phoenix (magazine)">The Phoenix</a>, Ireland</li>` +
        `${item("Phoenix, Illinois", "Phoenix, Illinois, a village")}${item("Phoenix, Georgia")}</ul>`,
    );
    expect(regionalNamesake(phoenix, "Phoenix", "Europe")).toBe(false);
    // A village of the name doesn't count; a place whose line or section names the country does.
    expect(regionalNamesake(disambiguation(`<ul>${item("Arlington, Devon", "Arlington, Devon, a village in England")}</ul>`), "Arlington", "Europe")).toBe(
      false,
    );
    const hamilton = disambiguation(
      `<section><div class="mw-heading"><h2>Places</h2></div><section><div class="mw-heading"><h3>Scotland</h3></div>` +
        `<ul>${item("Hamilton, South Lanarkshire")}</ul></section></section>`,
    );
    expect(regionalNamesake(hamilton, "Hamilton", "Europe")).toBe(true);
    const aside = disambiguation(`<ul>${item("Hamilton, South Lanarkshire", "Hamilton, South Lanarkshire, Scotland (formerly Cadzow)")}</ul>`);
    expect(regionalNamesake(aside, "Hamilton", "Europe")).toBe(true);
    // An article of the name: by its infobox's country (Valencia is Spain's); not a disambiguation page, no list read.
    const article = (country: string, body = "") =>
      cheerio.load(`<div class="mw-parser-output"><table class="infobox"><tr><th>Country</th><td>${country}</td></tr></table>${body}</div>`);
    expect(regionalNamesake(article("Spain"), "Valencia", "Europe")).toBe(true);
    expect(regionalNamesake(article("China", `<ul>${item("Suzhou, Spain")}</ul>`), "Suzhou", "Europe")).toBe(false);
  });
});

describe("matchFacts", () => {
  const fact = (source: string) => ({ text: "A fact.", source: `https://en.wikipedia.org/wiki/${source}` });
  const entry = (name: string, article = name, aliases: string[] = []) => ({ name, article, aliases });

  it("keeps a fact through a rename: by normalized name, source article, article title or alias", () => {
    const facts = {
      "Shape Of You": fact("Shape_Of_You"),
      "The Lion King": fact("The_Lion_King_(2019_film)"),
      "Detective Conan": fact("Case_Closed"),
      Bangkok: fact("Bangkok"),
    };
    const top = [
      entry("Shape of You"),
      entry("The Lion King (2019)", "The Lion King (2019 film)", ["The Lion King"]),
      entry("Case Closed / Detective Conan", "Case Closed"),
      entry("Bangkok"),
    ];
    expect(matchFacts(facts, top)).toEqual(["Shape Of You", "The Lion King", "Detective Conan", "Bangkok"]);
  });

  it("gives a key to one answer only, and never one another answer fits as well", () => {
    // "The Lion King" is an alias of both films: neither gets the fact by alias.
    const facts = { "The Lion King": { text: "A fact.", source: "https://en.wikipedia.org/wiki/The_Lion_King" } };
    const top = [
      entry("The Lion King (2019)", "The Lion King (2019 film)", ["The Lion King"]),
      entry("The Lion King (1994)", "The Lion King (1994 film)", ["The Lion King"]),
    ];
    expect(matchFacts(facts, top)).toEqual([undefined, undefined]);
    // An exact name wins over a fact sourced from the same article.
    expect(matchFacts({ Paris: fact("Paris"), "Paris, France": fact("Paris") }, [entry("Paris")])).toEqual(["Paris"]);
  });

  it("gives every built list the facts a rebuild would: a fact patched into a daily by hand is in scripts/facts too", () => {
    const dir = join(import.meta.dirname, "..", "public", "puzzles");
    let lists = 0;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const p: Partial<Puzzle> = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (!p.id || !p.answers) continue;
      lists++;
      const facts = readFacts(p.id);
      const keys = matchFacts(facts, p.answers);
      expect(p.answers.map((e) => e.fact ?? null), p.id).toEqual(keys.map((k) => (k ? facts[k] : null)));
    }
    expect(lists).toBeGreaterThan(50);
  });
});

describe("dated values", () => {
  it("label a table by the first year in its headers, else its title", () => {
    expect(datedLabel({}, ["Arrivals 2024", "Rank"], "2024")).toBe("2024");
    expect(datedLabel({}, ["Net worth (USD)", "No."], "1987–1989")).toBe("1987–1989");
    expect(datedLabel({}, ["Vehicles"], "2003-2004")).toBe("2003–2004");
    expect(datedLabel({ label: "Q4 {year}" }, ["Fourth quarter"], "2025")).toBe("Q4 2025");
    expect(datedLabel({ label: "2026" }, ["Password"], "Huntress")).toBe("2026");
    expect(datedLabel({}, ["Password"], "Huntress")).toBeUndefined();
  });

  it("read the latest year of a label", () => {
    expect(labelYear("1987–1989")).toBe(1989);
    expect(labelYear("Q4 2025")).toBe(2025);
  });

  it("read as the owner asked: rank, year, then what else is known", () => {
    expect(datedValue("2024", 6, "16.5 million")).toBe("#6 in 2024 (16.5 million)");
    expect(datedValue("2019", 3)).toBe("#3 in 2019");
    expect(datedValue("2026", 14, undefined, "Huntress")).toBe("#14 in 2026 (Huntress)");
    expect(datedValue("2016", 43, "3.0 million", "Mastercard")).toBe("#43 in 2016 (Mastercard, 3.0 million)");
    expect(datedValue("2016", undefined, "1,094,360")).toBe("1,094,360 (2016)");
    expect(datedValue("2016", undefined, undefined)).toBeUndefined();
  });

  it("label a row of a table with one row per year by that row's year", () => {
    // `perYear`: each year's top tour, the record as it grew, and other countries' rankings with a place in the label.
    expect(datedValue(datedLabel({}, ["2025"], "")!, 1, "$407,600,113")).toBe("#1 in 2025 ($407,600,113)");
    expect(datedValue(datedLabel({ label: "the record in {year}" }, ["1990"], "")!, undefined, "$175,000,000")).toBe(
      "$175,000,000 (the record in 1990)",
    );
    expect(datedValue(datedLabel({ label: "the US, 2025" }, ["Rank"], "")!, 10, "$129 billion")).toBe(
      "#10 in the US, 2025 ($129 billion)",
    );
    expect(labelYear("the US, 2025")).toBe(2025);
    // A cell listing every year it happened is labelled by the latest; a fixed figure for a "who passed $100
    // million" table.
    expect(lastYear("3 (2023, 2025, 2026)")).toBe("2026");
    expect(lastYear("2018–2019")).toBe("2018–2019");
    expect(datedValue(datedLabel({}, [lastYear("1 (2024)")], "")!, undefined, "$100 million+")).toBe("$100 million+ (2024)");
  });

  it("give a show's name to its highest-ranked season only", () => {
    const rows: Parameters<typeof lowerParts>[0] = [
      { part: { base: "Squid Game" }, aliasSeeds: ["Squid Game"], redirectTarget: "Squid Game", link: "Squid Game" },
      { part: { base: "Wednesday" }, aliasSeeds: ["Wednesday"], redirectTarget: "Wednesday (TV series)", link: "Wednesday (TV series)" },
      { part: { base: "Squid Game", link: "Squid Game season 2" }, aliasSeeds: ["Squid Game"], redirectTarget: "Squid Game" },
      { part: { base: "Wednesday" }, aliasSeeds: ["Wednesday"], redirectTarget: "Wednesday (Season 2)" },
    ];
    lowerParts(rows);
    expect(rows[0]).toMatchObject({ aliasSeeds: ["Squid Game"], redirectTarget: "Squid Game" });
    expect(rows[0].part?.lower).toBeUndefined();
    // Season 2 has an article of its own, whose redirects are its names; Wednesday's has none: the show's article,
    // without the show's redirects.
    expect(rows[2]).toMatchObject({ aliasSeeds: [], redirectTarget: "Squid Game season 2", part: { lower: true } });
    expect(rows[3]).toMatchObject({ aliasSeeds: [], redirectTarget: "Wednesday (TV series)", redirects: false });
  });

  it("scale figures into the list's unit", () => {
    expect(scaledFigure(16_500_000, 1e6)).toBe("16.5");
    expect(scaledFigure(9_985_100, 1e6)).toBe("10.0");
    expect(scaledFigure(720_000, 1e6)).toBe("0.72");
    expect(scaledFigure(4_238_000, 1e3)).toBe("4,238");
  });

  it("read rank cells", () => {
    expect(rankOf("6")).toBe(6);
    expect(rankOf("=5")).toBe(5);
    expect(rankOf("3/4")).toBe(3);
    expect(rankOf("-")).toBeUndefined();
    expect(rankOf("")).toBeUndefined();
    expect(rankOf(undefined)).toBeUndefined();
  });

  it("show a low and a high estimate as one range", () => {
    expect(rangeText("400 million", "600 million")).toBe("400–600 million");
    expect(rangeText("500 million", "1 billion")).toBe("500 million–1 billion");
    expect(rangeText("600 million", "600 million")).toBe("600 million");
  });
});

describe("ranking order", () => {
  const rows = () => [{ value: 26 }, { value: 0.44 }, { value: 61, tiebreak: 1 }, { value: 61, tiebreak: 2 }, { value: 2 }];

  it("puts the biggest first, the higher tiebreak first between equals", () => {
    expect(rankRows({}, rows())).toEqual([{ value: 61, tiebreak: 2 }, { value: 61, tiebreak: 1 }, { value: 26 }, { value: 2 }, { value: 0.44 }]);
  });

  it("puts the smallest first on a lowerIsBetter list (the smallest countries), and keeps a table's own order", () => {
    expect(rankRows({ lowerIsBetter: true }, rows()).map((r) => r.value)).toEqual([0.44, 2, 26, 61, 61]);
    expect(rankRows({ lowerIsBetter: true }, rows())[3]).toEqual({ value: 61, tiebreak: 2 });
    expect(rankRows({ keepOrder: true, lowerIsBetter: true }, rows())).toEqual(rows());
  });

  it("reads the page's tables first, then the other pages' (one ranking split by region)", () => {
    expect(rankedSources({ page: "Index", tables: [], pages: [{ page: "Africa", tables: [0] }, { page: "Europe", tables: [0] }] })).toEqual([
      { page: "Index", tables: [] },
      { page: "Africa", tables: [0] },
      { page: "Europe", tables: [0] },
    ]);
    expect(rankedSources({ page: "List", tables: [0, 1] })).toEqual([{ page: "List", tables: [0, 1] }]);
  });
});

describe("skipName", () => {
  it("skips total rows", () => {
    for (const s of ["Total", "Totals", "Total:", "TOTAL", "Total (2023)", "Total world", "Total US and territories", "Grand total", "Subtotal"]) {
      expect(skipName(s), s).toBe(true);
    }
  });

  it("keeps names that start with Total", () => {
    for (const s of ["TotalEnergies", "TotalBiscuit", "Totally Accurate Battlegrounds", "Total War", "Total Recall", "Total Eclipse of the Heart"]) {
      expect(skipName(s), s).toBe(false);
    }
  });
});

describe("sameKey", () => {
  it("meets the ʻokina and the apostrophe", () => {
    expect(sameKey("Nukuʻalofa")).toBe(sameKey("Nuku'alofa"));
  });

  it("keeps a numbered part apart from the thing's other parts", () => {
    // Bridgerton's cited Season 3 merged into the ranked Season 1 (cycle 5).
    expect(sameKey("Bridgerton (Season 3)")).not.toBe(sameKey("Bridgerton (Season 1)"));
    expect(sameKey("Bridgerton (Season 3)")).not.toBe(sameKey("Bridgerton"));
    expect(sameKey("Avatar (2009 film)")).toBe(sameKey("Avatar"));
  });
});

describe("placeholder rows", () => {
  it("are skipped", () => {
    for (const s of ["Untitled Peaky Blinders sequel series", "Untitled Jonestown docuseries", "Awaiting release", "TBA", "To be announced"]) {
      expect(skipName(s), s).toBe(true);
    }
  });

  it("leave works named Untitled alone", () => {
    for (const s of ["Untitled Goose Game", "Untitled", "Untitled Unmastered"]) expect(skipName(s), s).toBe(false);
  });
});

describe("country demonyms", () => {
  const line = (country: string) => COUNTRY_FORMS.find((f) => f[0] === country) ?? [];
  it("join their country's forms", () => {
    expect(line("United States")).toContain("American");
    expect(line("China")).toContain("Chinese");
    expect(line("India")).toContain("Indian");
    expect(line("France")).toContain("French");
  });

  it("belong to one country each", () => {
    const seen = new Map<string, string>();
    for (const forms of COUNTRY_FORMS) {
      for (const f of forms.slice(1)) {
        const other = seen.get(f.toLowerCase());
        expect(other === undefined || other === forms[0], `${f}: ${other} and ${forms[0]}`).toBe(true);
        seen.set(f.toLowerCase(), forms[0]);
      }
    }
  });
});

describe("mergeIndex", () => {
  it("keeps every indexed list and adds new ones in topic order", () => {
    const e = (id: string) => ({ id, title: id, category: "Geography", blitz: false });
    const merged = mergeIndex([e("countries-population"), e("countries-gdp")], [e("countries-area"), { ...e("countries-gdp"), blitz: true }]);
    expect(merged.map((x) => x.id)).toEqual(["countries-population", "countries-area", "countries-gdp"]);
    expect(merged[2].blitz).toBe(true);
  });
  it("gives every entry its debut flag from topics.ts, built now or not, and drops it once topics.ts does", () => {
    const e = (id: string, debut?: true) => ({ id, title: id, category: "Food", blitz: true, ...(debut ? { debut } : {}) });
    const topics = [{ id: "a" }, { id: "b", debut: true }, { id: "c", debut: true }, { id: "d" }];
    // b was built before it had the flag; c is built now; d had the flag and lost it in topics.ts.
    const merged = mergeIndex([e("a"), e("b"), e("d", true)], [e("c", true)], topics);
    expect(merged).toEqual([e("a"), e("b", true), e("c", true), e("d")]);
    expect("debut" in merged[0]).toBe(false);
  });
});
