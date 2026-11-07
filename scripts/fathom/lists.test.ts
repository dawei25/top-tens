import { describe, expect, it } from "vitest";
import { normalize } from "../../src/game/match";
import { checkCountryLists, checkList, COUNTRY_LISTS, loadLists, type NameList } from "./lists";

const lists = loadLists();
const byId = new Map(lists.map(({ list }) => [list.id, list]));

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
  it("holds the four lists the name-it round plays", () => {
    expect([...byId.keys()].sort()).toEqual(["cities-population", "countries-area", "countries-population", "land-borders"]);
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

  it("counts land borders as neighbouring countries, not border segments", () => {
    const borders = new Map(byId.get("land-borders")!.entries.map((e) => [e.name, e.value]));
    // Belgium has 39 border segments with 4 neighbours; island countries have none.
    expect(Object.fromEntries(["Belgium", "Brazil", "China", "Russia", "Japan", "Australia", "Portugal"].map((n) => [n, borders.get(n)]))).toEqual({
      Belgium: 4, Brazil: 10, China: 14, Russia: 14, Japan: 0, Australia: 0, Portugal: 1,
    });
    // 38 in November 2026: Japan, Australia, Cuba, Madagascar, Fiji, Taiwan...
    expect([...borders.values()].filter((v) => v === 0).length).toBeGreaterThanOrEqual(35);
  });

  it("ranks the cities by one measure, the source's UN 2025 estimates", () => {
    const cities = byId.get("cities-population")!;
    expect(cities.entries.length).toBeGreaterThanOrEqual(80);
    const top = [...cities.entries].sort((a, b) => b.value - a.value)[0];
    expect(top.value).toBeGreaterThan(30e6);
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
  });
});
