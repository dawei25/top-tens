// The name-it round on the real bank, lists and lexicon (public/fathom, public/puzzles/lexicon.json): what a judge typed
// on the 12 questions (Nov 8, about 50 answers each) and the readings that were wrong, each pinned here so it can't come
// back. The fixture-list tests are in fathom.test.ts ("name-it: reading the name").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nameLine, readList, readName, type NameList, type NameRead } from "./fathom-name";
import type { Lexicon } from "./junk";

const PUBLIC = join(import.meta.dirname, "..", "..", "public");
const LIST_IDS = ["countries-population", "countries-area", "land-borders", "cities-population"];
const LISTS = new Map(LIST_IDS.map((id) => [id, readList(JSON.parse(readFileSync(join(PUBLIC, "fathom", "lists", `${id}.json`), "utf8")))!]));
const LEX = JSON.parse(readFileSync(join(PUBLIC, "puzzles", "lexicon.json"), "utf8")) as Lexicon;
interface NameQ {
  id: string;
  round?: string;
  list: string;
  except?: string[];
}
const QUESTIONS = (JSON.parse(readFileSync(join(PUBLIC, "fathom", "questions.json"), "utf8")).questions as NameQ[]).filter((q) => q.round === "name");
const COUNTRY_QS = QUESTIONS.filter((q) => q.list !== "cities-population");
const CITY_QS = QUESTIONS.filter((q) => q.list === "cities-population");
/**
 * One question for each list (a reading only depends on the list and the yardstick), and every one with a yardstick:
 * the matcher over four lists is slow enough that all 12 questions for every answer would take seconds.
 */
const ONE_EACH = (qs: NameQ[]) => qs.filter((q, i) => q.except || qs.findIndex((x) => x.list === q.list && !x.except) === i);
const COUNTRY_EACH = ONE_EACH(COUNTRY_QS);
const CITY_EACH = ONE_EACH(CITY_QS);

/** What the round makes of `typed` on question `q`, as one line: "answer Libya", "confirm Dhaka", or the line it says. */
function reads(typed: string, q: NameQ, lex: Lexicon | undefined = LEX): string {
  const list = LISTS.get(q.list)!;
  const r: NameRead = readName(typed, list, [...LISTS.values()], { lex, except: q.except });
  if (r.kind === "answer" || r.kind === "confirm") return `${r.kind} ${r.entry.name}`;
  if (r.kind === "choose") return `choose ${r.names.join(" / ")}`;
  return nameLine(r, list);
}
const named = (l: NameList) => l.entries.length;
const COUNTRIES = named(LISTS.get("countries-population")!);
const CITIES = named(LISTS.get("cities-population")!);

describe("name-it on the real lists: the judge's readings (Nov 8)", { timeout: 30_000 }, () => {
  it("plays all 12 name-it questions: 10 on country lists, 2 on the city list", () => {
    expect(COUNTRY_QS.length).toBe(10);
    expect(CITY_QS.length).toBe(2);
  });

  // "England", "Scotland" and "Wales" locked the whole UK. They are parts of it: free, and said so.
  it("reads England, Scotland, Wales and Northern Ireland as parts of the UK, never as the UK", () => {
    for (const q of COUNTRY_QS)
      for (const part of ["England", "Scotland", "Wales", "Northern Ireland", "scotland", "WALES"]) {
        const name = part[0].toUpperCase() + part.slice(1).toLowerCase().replace(/ireland$/, "Ireland");
        expect(reads(part, q), `${q.id}: ${part}`).toBe(`${name} is part of the UK. Try again.`);
      }
    // Nor do their people: "Scottish" and "Welsh" were aliases of the UK too.
    for (const q of COUNTRY_EACH) for (const w of ["Scottish", "Welsh", "English"]) expect(reads(w, q), `${q.id}: ${w}`).not.toBe("answer United Kingdom");
    // The UK itself still locks, by any of its names.
    for (const uk of ["UK", "United Kingdom", "Britain", "Great Britain"]) expect(reads(uk, COUNTRY_QS[0]), uk).toBe("answer United Kingdom");
  });

  // Tasmania was offered as Tanzania, Bali as Mali, Corsica and Sardinia said "isn't one of our countries".
  it("reads islands and regions as part of their country, and never corrects them into another country", () => {
    const parts: [string, string][] = [
      ["Tasmania", "Australia"],
      ["Bali", "Indonesia"],
      ["Java", "Indonesia"],
      ["Sumatra", "Indonesia"],
      ["Corsica", "France"],
      ["Sardinia", "Italy"],
      ["Sicily", "Italy"],
      ["Crete", "Greece"],
      ["Hokkaido", "Japan"],
      ["Zanzibar", "Tanzania"],
      ["Phuket", "Thailand"],
      ["Bavaria", "Germany"],
      ["Siberia", "Russia"],
      ["Quebec", "Canada"],
      ["Flanders", "Belgium"],
    ];
    for (const q of COUNTRY_EACH) {
      for (const [place, country] of parts) expect(reads(place, q), `${q.id}: ${place}`).toBe(`${place} is part of ${country}, not a country.`);
      expect(reads("Hawaii", q)).toBe("Hawaii is a US state, not a country. Try again.");
      expect(reads("Greenland", q)).toBe("Greenland is a territory, not a country. Try again.");
      expect(reads("Borneo", q)).toBe("Borneo is an island, not a country. Try again.");
      expect(reads("Scandinavia", q)).toBe("Scandinavia is a region, not a country. Try again.");
      expect(reads("Yugoslavia", q)).toBe("Yugoslavia is no longer a country. Try again.");
    }
  });

  // A real name the lexicon knows is never put in the box as a different one: Abkhazia is not Afghanistan.
  it("never offers a known name as a misspelling of another, unless the game stores it as one (Irak)", () => {
    for (const q of COUNTRY_EACH) {
      expect(reads("Abkhazia", q), q.id).toBe(`Abkhazia isn't one of our ${COUNTRIES} countries. Try again.`);
      expect(reads("Dubai", q), q.id).toBe(`Dubai isn't one of our ${COUNTRIES} countries. Try again.`);
      // "Irak" is an alias of Iraq on the real lists, and a stored slip of it in the lexicon: still read as Iraq.
      expect(reads("Irak", q), q.id).toMatch(/^(answer Iraq|choose Iran \/ Iraq)$/);
    }
  });

  // "Dubai" and "Boston" were offered as Mumbai and Houston; "Africa" was South Africa, a country.
  it("on a city question: a city not on the list says so, and a continent is a continent", () => {
    for (const q of CITY_EACH) {
      for (const city of ["Dubai", "Boston", "Berlin", "Rome", "Sydney", "Vienna", "Las Vegas", "Algiers"])
        expect(reads(city, q), `${q.id}: ${city}`).toBe(`${city} isn't one of our ${CITIES} cities. Try again.`);
      for (const c of ["Africa", "South America", "Europe", "Asia"]) expect(reads(c, q), `${q.id}: ${c}`).toBe(`${c} is a continent, not a city. Try again.`);
      expect(reads("England", q)).toBe("England is part of the UK, not a city.");
      expect(reads("Dakha", q)).toMatch(/^(answer|confirm) Dhaka$/);
      expect(reads("Brooklyn", q)).toBe("Brooklyn is part of New York City, not a city.");
    }
  });

  // Without the lexicon (it hadn't loaded) a city is never misread either: it may only be a name we don't know.
  it("never misreads a known place without the lexicon", () => {
    for (const q of [...COUNTRY_EACH, ...CITY_EACH])
      for (const place of ["Dubai", "Boston", "Tasmania", "Bali", "Africa", "South America", "Scotland", "Abkhazia", "Vienna", "Algiers"]) {
        const r = reads(place, q, undefined);
        expect(r, `${q.id}: ${place}`).not.toMatch(/^(answer|confirm|choose) /);
      }
  });

  it("knows the spellings the judge found missing", () => {
    const spellings: [string, string][] = [
      ["Lybia", "Libya"],
      ["Byelorussia", "Belarus"],
      ["Kampuchea", "Cambodia"],
      ["Kirghizia", "Kyrgyzstan"],
      ["Lao", "Laos"],
      ["Jibuti", "Djibouti"],
      ["Dominican Rep", "Dominican Republic"],
      ["Dominican Rep.", "Dominican Republic"],
      ["Central African Rep", "Central African Republic"],
      ["North Korea", "North Korea"],
      ["Korea, North", "North Korea"],
      ["Korea, South", "South Korea"],
      ["Gambia, The", "Gambia"],
      ["Hindustan", "India"],
    ];
    for (const q of COUNTRY_EACH)
      for (const [typed, name] of spellings) {
        const except = q.except?.includes(name);
        expect(reads(typed, q), `${q.id}: ${typed}`).toBe(except ? `Any country but ${name}. Try again.` : `answer ${name}`);
      }
    for (const q of CITY_QS) expect(reads("Dakha", q)).toMatch(/Dhaka$/);
  });
});
