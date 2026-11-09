// The first-time-player review before launch (Nov 9): each finding pinned here, on the real bank and lists where it
// matters. The layout findings (the unit beside the field, LOST AT SEA, the Home key at 320) are in the browser suite.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  amountText,
  BAND_CHARS,
  BANDS,
  figureParts,
  formatAmount,
  formatColumn,
  formatDigits,
  missText,
  pointsOff,
  readBank,
  ruleFor,
  ruleShownAt,
  shareText,
  type Band,
  type FathomQuestion,
  type Scored,
} from "./fathom";
import { LINE_MAX, nameLine, PLACES, readFullBank, readList, readName, type NameList } from "./fathom-name";

const PUBLIC = join(import.meta.dirname, "..", "..", "public", "fathom");
const RAW = JSON.parse(readFileSync(join(PUBLIC, "questions.json"), "utf8"));
const LISTS = new Map(
  ["countries-population", "countries-area", "land-borders", "cities-population"].map((id) => [id, readList(JSON.parse(readFileSync(join(PUBLIC, "lists", `${id}.json`), "utf8")))!]),
);
const BANK = readFullBank(RAW, LISTS)!;
const decimals = (s: string) => (s.match(/\.(\d+)/)?.[1].length ?? 0);

describe("the first-time review (Nov 9)", () => {
  // "8.80419 million people" on New York City's reveal and results.
  it("shows no answer, figure or best answer with more than 3 decimals; 42.195 as it is", () => {
    expect(formatAmount(8.80419)).toBe("8.804");
    expect(formatAmount(42.195)).toBe("42.195");
    expect(formatDigits(0.0625)).toBe("0.063");
    expect(formatAmount(1234.5678)).toBe("1,235");
    for (const q of BANK) {
      for (const text of [figureParts(q, q.answer).n, amountText(q, q.answer)]) expect(decimals(text), `${q.id}: ${text}`).toBeLessThanOrEqual(3);
      // A guess a little off, as a player types it, the same.
      if (q.round !== "year") expect(decimals(figureParts(q, q.answer * 1.23456).n), q.id).toBeLessThanOrEqual(3);
    }
    for (const list of LISTS.values()) for (const f of formatColumn(list.entries.map((e) => e.value))) expect(decimals(f), f).toBeLessThanOrEqual(3);
    // Nothing in the bank is so small that 3 decimals round it away.
    for (const q of readBank(RAW)!) expect(q.answer >= 0.01, q.id).toBe(true);
  });

  // "NEAR 68 points" beside "12 points high": two meanings of points on one card.
  it("says a percent's miss without the word points", () => {
    expect(pointsOff(62, 50)).toBe("12 too high");
    expect(pointsOff(44, 50)).toBe("6 too low");
    expect(pointsOff(52.5, 50)).toBe("2.5 too high");
    expect(pointsOff(50.3, 50)).toBe("spot on");
    for (const q of BANK.filter((x) => x.round === "percent")) for (const g of [0, 10, 50, 99]) expect(missText(q, g), q.id).not.toMatch(/points?/);
  });

  // The rule showed on the first estimate, the first percent and the first year (all the same words), so a game whose
  // third question was a second estimate looked as if it had lost its line.
  it("says each scoring line once a game, on the first question that has it", () => {
    const est = { round: undefined, unit: "metres" } as Pick<FathomQuestion, "round" | "unit" | "nameIt">;
    const pct = { round: "percent", unit: "percent" } as const;
    const year = { round: "year", unit: "year" } as const;
    const name = BANK.find((q) => q.round === "name")!;
    const game = [est, pct, est, year, name];
    expect(game.map((_, i) => ruleShownAt(game, i))).toEqual([true, false, false, false, true]);
    expect(ruleFor(name)).not.toBe(ruleFor(est));
    const pctFirst = [pct, est, year, est, name];
    expect(pctFirst.map((_, i) => ruleShownAt(pctFirst, i))).toEqual([true, false, false, false, true]);
  });

  // The share text: squares in the colours the results show, the emoji the list share uses where they match.
  it("shares each band as an emoji square in its own colour, all different, none an empty box", () => {
    const want: Record<Band, string> = { "dead-on": "🟨", close: "🟦", near: "🟪", far: "🟥", lost: "⬛" };
    expect(BAND_CHARS).toEqual(want);
    expect(new Set(Object.values(BAND_CHARS)).size).toBe(BANDS.length);
    const scored = BANDS.map((b) => ({ band: b.band, points: b.min }) as Scored);
    expect(shareText(scored, "https://toptentacle.io/#fathom")).toBe(`Fathom 215/500\n🟨 🟦 🟪 🟥 ⬛\nhttps://toptentacle.io/#fathom`);
  });

  // "Tasmania is part of Australia, not a country." lacked the "Try again." that Scotland's and Paris's lines have.
  it("ends every line about a thing of another kind the same way, within two lines at 320px", () => {
    const pop = LISTS.get("countries-population")!;
    const cities = LISTS.get("cities-population")!;
    const none: NameList = { ...pop, entries: [{ name: "Nowhere", aliases: [], value: 1 }] };
    for (const p of PLACES)
      for (const n of p.names)
        for (const l of [pop, cities]) {
          const line = nameLine(readName(n, { ...none, noun: l.noun, nounPlural: l.nounPlural }, []), l);
          expect(line, n).toMatch(/ Try again\.$/);
          expect(line.length, line).toBeLessThanOrEqual(LINE_MAX);
        }
    expect(nameLine(readName("Tasmania", pop, [...LISTS.values()]), pop)).toBe("Tasmania is part of Australia, not a country. Try again.");
    for (const typed of ["Paris", "Scotland", "Greenland", "Atlantis", "asdf"]) expect(nameLine(readName(typed, pop, [...LISTS.values()]), pop)).toMatch(/ Try again\.$/);
  });

  // The best answers mixed "996,600" with "1.067 million" in one column.
  it("writes a column of figures one way", () => {
    expect(formatColumn([996600, 956044, 944388, 1067000])).toEqual(["996,600", "956,044", "944,388", "1,067,000"]);
    expect(formatColumn([49.8e6, 51.09e6, 51.38e6, 47.4e6])).toEqual(["49.8 million", "51.09 million", "51.38 million", "47.4 million"]);
    expect(formatColumn([6, 6, 7, 5])).toEqual(["6", "6", "7", "5"]);
    const way = (f: string) => (/million|billion/.test(f) ? "words" : "digits");
    for (const list of LISTS.values())
      for (const target of [list.entries[0].value, list.entries[Math.floor(list.entries.length / 2)].value]) {
        const best = [...list.entries].sort((a, b) => Math.abs(Math.log((a.value + 1) / (target + 1))) - Math.abs(Math.log((b.value + 1) / (target + 1)))).slice(0, 4);
        expect(new Set(formatColumn(best.map((e) => e.value)).map(way)).size, list.id).toBe(1);
      }
  });
});
