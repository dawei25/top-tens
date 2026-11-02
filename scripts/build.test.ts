import { describe, expect, it } from "vitest";
import { datedLabel, datedValue, labelYear, matchFacts, mergeIndex, rankOf, sameKey, scaledFigure, skipName } from "./build";
import { COUNTRY_FORMS } from "./intent";

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
});
