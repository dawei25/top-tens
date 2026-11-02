import { describe, expect, it } from "vitest";
import { plainWords } from "./lexicon";

describe("plainWords", () => {
  const dictionary = ["humans", "destroy", "all", "cowboys", "dallas", "swift", "jordan", "water", "an"];
  const names = ["Destroy All Humans!", "Dallas Cowboys", "Taylor Swift", "Michael Jordan", "Walter Masterson", "Jordan"];
  const words = plainWords(names, new Set(["jordan", "destroy all humans"]), ["Dallas Cowboys", "Taylor Swift"], dictionary);

  it("lists ordinary words that are part of names", () => {
    expect(words).toEqual(expect.arrayContaining(["humans", "destroy", "all"]));
  });

  it("leaves out names, and the words players name top-10 answers and ranked people by", () => {
    // "jordan" is a name; "cowboys" is how the Dallas Cowboys are named; "swift" is Taylor Swift.
    for (const w of ["jordan", "cowboys", "dallas", "swift"]) expect(words).not.toContain(w);
  });

  it("only lists words found in some name, of three letters or more", () => {
    expect(words).not.toContain("water");
    expect(words).not.toContain("an");
  });
});
