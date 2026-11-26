import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalize } from "../../src/game/match";
import { readList, readName } from "../../src/game/fathom-name";
import type { Lexicon } from "../../src/game/junk";
import type { Puzzle } from "../../src/game/types";
import { blockedAlias, CITY_JUNK } from "../aliases";
import {
  AGGLOMERATIONS,
  agglomerationRows,
  checkCountryLists,
  checkList,
  checkStateLists,
  CITY_POOLS,
  COUNTRY_LISTS,
  FORMS,
  isPlace,
  keptForms,
  loadLists,
  METRO_SYSTEM,
  NOT_A_NAME,
  ownKind,
  STATE_LISTS,
  WRONG_FORMS,
  type NameList,
} from "./lists";

const lists = loadLists();
const byId = new Map(lists.map(({ list }) => [list.id, list]));

const ROOT = join(import.meta.dirname, "..", "..");
/** The lexicon retrained Nov 22, live from Nov 26 (docs/REBUILD_QUEUE.md), and committed on its own branch first. */
const RETRAINED = "1e7e028";
/**
 * The lexicons a name-it round may read with: the committed one, the retrained one (from git, while main doesn't have it
 * yet; once it does, the committed one is it, or newer) and none (the timer ran out before it loaded).
 */
const LEXICONS: [string, Lexicon | undefined][] = [
  ["committed", JSON.parse(readFileSync(join(ROOT, "public", "puzzles", "lexicon.json"), "utf8")) as Lexicon],
  ...(() => {
    try {
      const json = execFileSync("git", ["show", `${RETRAINED}:public/puzzles/lexicon.json`], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 << 20,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return [[`retrained (${RETRAINED})`, JSON.parse(json) as Lexicon]] as [string, Lexicon][];
    } catch {
      return [];
    }
  })(),
  ["no", undefined],
];

/** A list that passes: 20 made-up countries, one alias each. */
function sample(over: Partial<NameList> = {}): NameList {
  return {
    id: "sample",
    noun: "country",
    nounPlural: "countries",
    measure: "people",
    scoring: "ratio",
    source: { title: "List of things", url: "https://en.wikipedia.org/wiki/List_of_things" },
    asOf: "2025",
    entries: Array.from({ length: 20 }, (_, i) => ({ name: `Land ${i + 1}`, aliases: [`Landia ${i + 1}`], value: 1000 * (i + 1) })),
    ...over,
  };
}

describe("Fathom name-it lists (public/fathom/lists)", () => {
  it("holds the lists the name-it round plays: four from Nov 8, density and the two US state lists from Nov 17", () => {
    expect([...byId.keys()].sort()).toEqual([
      "cities-population",
      "countries-area",
      "countries-density",
      "countries-population",
      "land-borders",
      "us-states-area",
      "us-states-population",
    ]);
  });

  it.each(lists.map(({ file, list }) => [file, list] as const))("%s is well formed, every name and alias one entry's", (file, list) => {
    expect(checkList(list, file)).toEqual([]);
  });

  it("the country lists share one set of countries: the 193 UN members, the Vatican, Palestine, Taiwan and Kosovo", () => {
    const countries = COUNTRY_LISTS.map((id) => byId.get(id)!);
    expect(checkCountryLists(countries)).toEqual([]);
    for (const l of countries) expect(l.entries.length).toBe(197);
    const names = new Set(countries[0].entries.map((e) => e.name));
    for (const n of ["Vatican City", "Palestine", "Taiwan", "Kosovo", "Tuvalu", "South Sudan", "United States"]) expect(names).toContain(n);
    // Territories and breakaway states are not countries here (Greenland is Denmark's, Puerto Rico the US's).
    for (const n of ["Greenland", "Puerto Rico", "Hong Kong", "Western Sahara", "Northern Cyprus", "Antarctica"])
      expect(names).not.toContain(n);
    // And the same country is typed the same way in every round.
    const forms = (l: NameList) => JSON.stringify(l.entries.map((e) => [e.name, [...e.aliases].sort()]).sort());
    for (const l of countries.slice(1)) expect(forms(l)).toBe(forms(countries[0]));
  });

  it("finds a country by its everyday forms", () => {
    const pop = byId.get("countries-population")!;
    const form = new Map(pop.entries.flatMap((e) => [e.name, ...e.aliases].map((f) => [normalize(f), e.name] as const)));
    const typed: Record<string, string> = {
      usa: "United States", uk: "United Kingdom", holland: "Netherlands", burma: "Myanmar", czechia: "Czech Republic",
      "ivory coast": "Ivory Coast", "east timor": "Timor-Leste", drc: "Democratic Republic of the Congo",
      "st lucia": "Saint Lucia", "st kitts": "Saint Kitts and Nevis", vatican: "Vatican City", "south korea": "South Korea",
    };
    for (const [t, name] of Object.entries(typed)) expect(form.get(normalize(t)), t).toBe(name);
    // "Congo" is two countries: neither list entry takes it alone.
    expect(form.get("congo")).toBeUndefined();
  });

  // Nov 8: "England", "Scotland" and "Wales" were aliases of the United Kingdom, so they locked the whole UK. A place of
  // its own (fathom-name.ts PLACES) is never an alias: the round says what it is ("Scotland is part of the UK.").
  it("carries no place of its own as an alias: England, Scotland, Wales, Northern Ireland, Tasmania...", () => {
    // A place of the list's own kind is its own entry ("New York State" on a US state list), and locks as it.
    const found = lists.flatMap(({ list }) =>
      list.entries.flatMap((e) => e.aliases.filter((a) => isPlace(a) && !ownKind(a, list.noun)).map((a) => `${list.id}: ${a} (${e.name})`)),
    );
    expect(found).toEqual([]);
    const uk = byId.get("countries-population")!.entries.find((e) => e.name === "United Kingdom")!;
    expect(uk.aliases.map(normalize)).not.toContain("england");
    expect(keptForms("United Kingdom", ["UK", "England", "Scotland", "Wales", "Northern Ireland", "Scottish", "Welsh", "British"])).toEqual(["UK", "British"]);
  });

  it("carries the forms a judge found missing, and no redirect that isn't a name or names something else", () => {
    for (const { list } of lists)
      for (const e of list.entries) {
        for (const f of FORMS[e.name] ?? []) expect(e.aliases, `${list.id}: ${e.name}`).toContain(f);
        expect(e.aliases.filter((a) => NOT_A_NAME.test(a)), `${list.id}: ${e.name}`).toEqual([]);
        for (const f of WRONG_FORMS[e.name] ?? []) expect(e.aliases.map(normalize), `${list.id}: ${e.name}`).not.toContain(normalize(f));
      }
    expect(keptForms("Zambia", ["Zamibia", "Zambian sports", "Traditional Zambian games"])).toEqual(["Zamibia"]);
  });

  it("counts land borders as neighbouring countries, not border segments", () => {
    const borders = new Map(byId.get("land-borders")!.entries.map((e) => [e.name, e.value]));
    // Belgium has 39 border segments with 4 neighbours; island countries have none.
    expect(Object.fromEntries(["Belgium", "Brazil", "China", "Russia", "Japan", "Australia", "Portugal"].map((n) => [n, borders.get(n)]))).toEqual({
      Belgium: 4, Brazil: 10, China: 14, Russia: 14, Japan: 0, Australia: 0, Portugal: 1,
    });
    // 38 in November 2026: Japan, Australia, Cuba, Madagascar, Fiji, Taiwan...
    expect([...borders.values()].filter((v) => v === 0).length).toBeGreaterThanOrEqual(35);
  });

  // Nov 17: "Name a country with about 100 people per square kilometre", worked out from a population and an area.
  it("reads density as the table gives it: people per square kilometre of land, the countries only", () => {
    const density = new Map(byId.get("countries-density")!.entries.map((e) => [e.name, e.value]));
    expect(Object.fromEntries(["Bangladesh", "Netherlands", "United Kingdom", "France", "United States", "Russia", "Canada", "Mongolia"].map((n) => [n, density.get(n)]))).toEqual({
      Bangladesh: 1333, Netherlands: 541, "United Kingdom": 287, France: 122, "United States": 37, Russia: 8.6, Canada: 4.5, Mongolia: 2.2,
    });
  });

  // Nov 17: "Name a US state with about 5 million people", "... about the same area as the UK". The 50 states (no DC, no
  // territories), one set and one set of forms in both lists, typed as people type them.
  it("the US state lists share the 50 states, typed by their everyday forms", () => {
    const states = STATE_LISTS.map((id) => byId.get(id)!);
    expect(checkStateLists(states)).toEqual([]);
    for (const l of states) expect(l.entries.length).toBe(50);
    const names = new Set(states[0].entries.map((e) => e.name));
    for (const n of ["District of Columbia", "Washington, D.C.", "Puerto Rico", "Guam"]) expect(names).not.toContain(n);
    const forms = (l: NameList) => JSON.stringify(l.entries.map((e) => [e.name, [...e.aliases].sort()]).sort());
    expect(forms(states[1])).toBe(forms(states[0]));
    const area = readList(byId.get("us-states-area"))!;
    const typed: Record<string, string> = {
      "New York State": "New York", NY: "New York", "Washington State": "Washington", Cali: "California", Calif: "California",
      "Hawaiʻi": "Hawaii", "Hawai'i": "Hawaii", Pensylvania: "Pennsylvania", Georgia: "Georgia", LA: "Louisiana", Mass: "Massachusetts",
    };
    for (const [t, name] of Object.entries(typed)) {
      const r = readName(t, area);
      expect(r.kind === "answer" || r.kind === "confirm" ? r.entry.name : r.kind, t).toBe(name);
    }
    // Areas are total areas, water included (Michigan takes in its share of the Great Lakes), as the countries' are.
    const value = (n: string) => area.entries.find((e) => e.name === n)!.value;
    expect(Object.fromEntries(["Alaska", "Texas", "Michigan", "Rhode Island"].map((n) => [n, value(n)]))).toEqual({
      Alaska: 1723337, Texas: 695662, Michigan: 250487, "Rhode Island": 4001,
    });
  });

  // Nov 26: the lexicon retrained Nov 22 (1e7e028, live from Nov 26) knows "hawaiian" as a name of its own (another
  // list's language), and a known name is never corrected into another answer, so on the state rounds it read
  // "Hawaiian isn't one of our 50 US states." (Hawaii to confirm with the lexicon before it). It is Hawaii's form on
  // these lists (FORMS), whatever the lexicon knows, as the game reads it: against every other list, with each lexicon.
  it('reads "hawaiian" as Hawaii on both US state lists, with the committed lexicon, the retrained one and none', () => {
    const all = lists.map(({ list }) => readList(list)!);
    for (const id of STATE_LISTS) {
      const list = all.find((l) => l.id === id)!;
      for (const [which, lex] of LEXICONS)
        for (const typed of ["hawaiian", "Hawaiian", "HAWAIIAN"]) {
          const r = readName(typed, list, all, { lex });
          expect(r.kind === "answer" || r.kind === "confirm" ? `${r.kind} ${r.entry.name}` : r.kind, `${id}, ${which} lexicon: ${typed}`).toBe("answer Hawaii");
        }
    }
  });

  // The owner, Nov 17: "i guessed rome for a city based question but it wasnt accepted". The list held the 85 largest
  // (5 million and up); now every urban agglomeration of 1 million or more, by one source and one measure.
  it("measures the cities by one measure, every urban area of 1 million or more, well-known ones included", () => {
    const cities = byId.get("cities-population")!;
    expect(cities.source).toEqual(AGGLOMERATIONS);
    expect(cities.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cities.entries.length).toBeGreaterThanOrEqual(600);
    expect(Math.min(...cities.entries.map((e) => e.value))).toBeGreaterThanOrEqual(1e6);
    const value = (n: string) => cities.entries.find((e) => e.name === n)?.value;
    for (const n of ["Rome", "Madrid", "Berlin", "Toronto", "Sydney", "Melbourne", "Chicago", "Barcelona", "Milan", "Tokyo", "New York City", "London", "Paris"])
      expect(value(n), n).toBeGreaterThan(2e6);
    expect(value("Rome")).toBe(3450000);
    // Two of a name: the better known keeps it, the other says where it is (Valencia, Venezuela).
    for (const n of ["Valencia, Venezuela", "Hyderabad, Pakistan", "Melbourne, Florida", "Taizhou, Zhejiang", "Taizhou, Jiangsu", "Suzhou, Anhui"]) expect(value(n), n).toBeGreaterThan(1e6);
  });

  // The coordinator, Nov 17: every city name and alias on TENtacle's city lists is a name the city round knows, so a
  // real city never reads "isn't one of our cities"; one with no figure on the list's measure says so instead.
  it("knows every city on TENtacle's city lists by its name, and its aliases but those no one types", () => {
    const cities = byId.get("cities-population")!;
    const known = new Map([...cities.entries, ...(cities.unmeasured ?? [])].flatMap((e) => [e.name, ...e.aliases].map((f) => [normalize(f), e.name] as const)));
    const others = new Set(lists.filter(({ list }) => list.noun !== "city").flatMap(({ list }) => list.entries.flatMap((e) => [e.name, ...e.aliases].map(normalize))));
    const junk = new Set(CITY_JUNK.map(normalize));
    // A name two cities of the lists share (Taizhou is two cities, both measured) is no one city's.
    const owners = new Map<string, Set<string>>();
    const pools = CITY_POOLS.flatMap((id) => {
      const p = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "public", "puzzles", `${id}.json`), "utf8")) as Puzzle;
      return [...p.answers, ...p.extras];
    });
    for (const e of pools) for (const a of e.aliases) owners.set(normalize(a), (owners.get(normalize(a)) ?? new Set()).add(e.name));
    const dropped = (form: string, name: string) =>
      isPlace(form) || isPlace(name) || NOT_A_NAME.test(form) || METRO_SYSTEM.test(form) || junk.has(normalize(form)) || blockedAlias(form, [name]) || (owners.get(normalize(form))?.size ?? 0) > 1;
    const unknownNames = pools.filter((e) => !known.has(normalize(e.name)) && !isPlace(e.name) && normalize(e.name) !== "taizhou").map((e) => e.name);
    expect([...new Set(unknownNames)]).toEqual([]);
    const unknownAliases = pools.flatMap((e) => e.aliases.filter((a) => !known.has(normalize(a)) && !others.has(normalize(a)) && !dropped(a, e.name)).map((a) => `${a} (${e.name})`));
    expect([...new Set(unknownAliases)]).toEqual([]);
    // What that reads as, on a city question.
    const list = readList(cities)!;
    const said = (t: string) => {
      const r = readName(t, list);
      return r.kind === "answer" ? `answer ${r.entry.name}` : r.kind === "unmeasured" ? `unmeasured ${r.name}${r.partOf ? ` in ${r.partOf}` : ""}` : r.kind;
    };
    expect(["Rome", "Roma", "Firenze", "Shenzhen", "Köln", "Howrah", "Chhatrapati Sambhajinagar"].map(said)).toEqual([
      "answer Rome", "answer Rome", "unmeasured Florence", "unmeasured Shenzhen in Guangzhou (Pearl River Delta)", "unmeasured Cologne in Rhine-Ruhr",
      "unmeasured Howrah in Kolkata", "answer Aurangabad",
    ]);
  });

  it("names no place two ways and keeps every unmeasured name off the entries", () => {
    const cities = byId.get("cities-population")!;
    expect(cities.unmeasured!.length).toBeGreaterThan(1500);
    const entries = new Set(cities.entries.map((e) => e.name));
    for (const k of cities.unmeasured!) if (k.partOf) expect(entries.has(k.partOf), `${k.name} in ${k.partOf}`).toBe(true);
    // The page's "incl." lists: the well-known places it counts in another city's figure.
    const partOf = new Map(cities.unmeasured!.filter((k) => k.partOf).map((k) => [k.name, k.partOf]));
    expect(Object.fromEntries(["Shenzhen", "Yokohama", "Kyoto", "Newark", "Fort Worth", "Giza", "Incheon", "Suzhou", "Cologne"].map((n) => [n, partOf.get(n)]))).toEqual({
      Shenzhen: "Guangzhou (Pearl River Delta)", Yokohama: "Tokyo", Kyoto: "Osaka", Newark: "New York City", "Fort Worth": "Dallas", Giza: "Cairo", Incheon: "Seoul", Suzhou: "Shanghai", Cologne: "Rhine-Ruhr",
    });
    // A name shared with places elsewhere is never said to be counted in one (which Springfield?).
    for (const n of ["Springfield", "Concord", "Hamilton", "Windsor", "Victoria"]) expect(partOf.get(n), n).toBeUndefined();
  });
});

describe("the agglomerations page (scripts/fathom/lists.ts)", () => {
  const page = (rows: string) =>
    `<html><body><p>Contents: all urban agglomerations (reference date: 2026-01-01).</p><table class="data"><tr><th>Rank</th><th>Name</th><th>English Name</th><th>Country</th><th>Population</th><th>Status</th><th>Remark</th></tr>${rows}</table></body></html>`;
  const row = (cells: string[], wiki?: string) =>
    `<tr><td>1</td><td${wiki ? ` data-wiki="${wiki}"` : ""}><a>${cells[0]}</a></td>${cells.slice(1).map((c) => `<td>${c}</td>`).join("")}</tr>`;

  it("reads each row: names, country, figure, and the places it counts in, with their own country", () => {
    const { rows, asOf } = agglomerationRows(
      page(
        row(["Al-Qāhirah", "Cairo", "Egypt", "23,200,000", "Aggl", "incl. Al-Jīzah [Giza], Shubrā al-Khaymah"], "Cairo") +
          row(["Detroit", "Detroit", "Canada", "5,850,000", "CUA", "incl. Toledo, Windsor (Canada)"]) +
          row(["Newcastle[upon Tyne", "Newcastle[upon Tyne", "Great Britain", "1,540,000", "CUA", ""]),
      ),
    );
    expect(asOf).toBe("2026-01-01");
    expect(rows).toEqual([
      {
        local: "Al-Qāhirah", english: "Cairo", wiki: "Cairo", country: "Egypt", population: 23200000,
        includes: [{ names: ["Al-Jīzah", "Giza"] }, { names: ["Shubrā al-Khaymah", "Shubra el-Kheima"] }],
      },
      { local: "Detroit", english: "Detroit", country: "Canada", population: 5850000, includes: [{ names: ["Toledo"] }, { names: ["Windsor"], country: "Canada" }] },
      { local: "Newcastle upon Tyne", english: "Newcastle upon Tyne", country: "Great Britain", population: 1540000, includes: [] },
    ]);
  });

  it("fails loudly on a new layout, a missing date or a figure under 1 million", () => {
    expect(() => agglomerationRows(page("").replace("Remark", "Notes"))).toThrow(/new table layout/);
    expect(() => agglomerationRows(page("").replace("reference date", "as of"))).toThrow(/reference date/);
    expect(() => agglomerationRows(page(row(["X", "X", "Chad", "900,000", "", ""])))).toThrow(/X has 900,000/);
  });
});

describe("checkList", () => {
  it("passes a well-formed list", () => {
    expect(checkList(sample())).toEqual([]);
  });

  it("rejects a name or alias two entries share, and an alias that repeats its own name", () => {
    const l = sample();
    l.entries[1].aliases.push("LAND 1");
    l.entries[2].aliases.push("Landia 4");
    l.entries[3].aliases.push("land-4");
    l.entries.push({ name: "Land 5", aliases: [], value: 5 });
    expect(checkList(l)).toEqual([
      '"LAND 1" is a name or alias of both Land 1 and Land 2',
      '"Landia 4" is a name or alias of both Land 3 and Land 4',
      'Land 4: "land-4" repeats one of its own forms',
      "two entries are called Land 5",
    ].map((e) => `sample: ${e}`));
  });

  it("wants positive values on a ratio list and whole counts on a steps list", () => {
    const zero = sample();
    zero.entries[0].value = 0;
    expect(checkList(zero)).toEqual(["sample: Land 1: a ratio list's value must be positive"]);
    const steps = sample({ scoring: "steps", measure: "land borders" });
    steps.entries[0].value = 0;
    expect(checkList(steps)).toEqual([]);
    steps.entries[1].value = 2.5;
    steps.entries[2].value = -1;
    expect(checkList(steps)).toEqual([
      "sample: Land 2: a steps list's value must be a whole number, 0 or more",
      "sample: Land 3: a steps list's value must be a whole number, 0 or more",
    ]);
    const nan = sample();
    nan.entries[0].value = Number.NaN;
    expect(checkList(nan)).toEqual(["sample: Land 1: value must be a finite number"]);
  });

  it("takes names known without a figure, each form one owner's, never a place of its own, `partOf` an entry", () => {
    expect(checkList(sample({ unmeasured: [{ name: "Hamlet", aliases: ["Hamletia"] }, { name: "Suburb", aliases: [], partOf: "Land 1" }] }))).toEqual([]);
    expect(
      checkList(
        sample({
          unmeasured: [
            { name: "Land 2", aliases: [] },
            { name: "Hamlet", aliases: ["Landia 3"] },
            { name: "Suburb", aliases: [], partOf: "Nowhere" },
            { name: "Scotland", aliases: [] },
          ],
        }),
      ),
    ).toEqual([
      '"Land 2" is a form of both Land 2 and unmeasured Land 2',
      '"Landia 3" is a form of both Land 3 and unmeasured Hamlet',
      "unmeasured Suburb: partOf Nowhere is no entry",
      "unmeasured Scotland is a place of its own (fathom-name.ts PLACES)",
    ].map((e) => `sample: ${e}`));
  });

  it("wants the shape the round reads", () => {
    expect(checkList(sample({ scoring: "times" as NameList["scoring"] }))).toEqual(['sample: scoring must be "ratio" or "steps"']);
    expect(checkList(sample({ asOf: "June 2025" }))).toEqual(["sample: asOf must be YYYY-MM-DD or a year"]);
    expect(checkList(sample({ source: { title: "List", url: "http://example.org" } }))).toEqual(["sample: source.url must be https"]);
    expect(checkList(sample({ measure: "People" }))).toEqual(['sample: measure "People" must be lower case']);
    expect(checkList({ ...sample(), colour: "red" } as NameList)).toEqual(['sample: unknown field "colour"']);
    expect(checkList(sample(), "other.json")).toEqual(["sample: id doesn't match its file name other.json"]);
    expect(checkList(sample({ entries: sample().entries.slice(0, 5) }))).toEqual(["sample: entries must be an array of at least 20"]);
  });
});

describe("checkCountryLists", () => {
  it("rejects country lists that name different countries", () => {
    const a = sample({ id: "a" });
    const b = sample({ id: "b" });
    b.entries[0] = { ...b.entries[0], name: "Elsewhere" };
    expect(checkCountryLists([a, b])).toEqual(["b lacks 1 of a's countries: Land 1", "b has 1 countries a lacks: Elsewhere"]);
    expect(checkStateLists([a])).toEqual(["a: noun must be US state"]);
  });
});

describe("keptForms", () => {
  it("keeps a place of the list's own kind, and only on a list of that kind", () => {
    expect(keptForms("New York", ["NY", "New York State", "Brooklyn"], "US state")).toEqual(["NY", "New York State"]);
    expect(keptForms("New York", ["NY", "New York State"], "country")).toEqual(["NY"]);
    expect(keptForms("New York", ["NY", "New York State"])).toEqual(["NY"]);
    expect(keptForms("Michigan", ["MI", "The land of ten-thousand lakes"], "US state")).toEqual(["MI"]);
  });
});
