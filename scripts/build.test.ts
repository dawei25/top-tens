import { describe, expect, it } from "vitest";
import { mergeIndex, sameKey, skipName } from "./build";
import { COUNTRY_FORMS } from "./intent";

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
