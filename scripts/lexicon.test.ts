import { describe, expect, it } from "vitest";
import { bankPlainWords, plainWords, type Bank } from "./lexicon";

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

describe("bankPlainWords", () => {
  const dictionary = ["humans", "music", "water", "rainier", "mount", "sapiens", "minecraft", "victoria", "lake", "falls"];
  // Minecraft is #1, Mount Rainier ranks #20 and Sapiens #66; the rest are unranked pool members, some named exactly
  // a plain word ("Humans", "Music": an obscure TV series and a song).
  const bank: Bank = {
    ranked: ["Minecraft", "Mount Rainier", "Sapiens: A Brief History of Humankind", "Water"],
    all: [
      "Minecraft", "Mount Rainier", "Sapiens: A Brief History of Humankind", "Water", "Destroy All Humans!", "Humans",
      "Pop'n Music", "Music", "Rainier", "Sapiens", "Victoria Falls", "Lake Victoria",
    ],
    namesOfNote: ["Minecraft"],
    figured: ["Minecraft", "Mount Rainier", "Sapiens: A Brief History of Humankind", "Water"],
  };
  const words = bankPlainWords(bank, ["Victoria"], dictionary);

  it("doesn't let an unranked pool member named exactly a word keep it from being plain", () => {
    // "humans" no longer offers Destroy All Humans! because some obscure entry is called "Humans".
    expect(words).toEqual(expect.arrayContaining(["humans", "music"]));
  });

  it("keeps ranked names, aliases and places as names", () => {
    expect(words).not.toContain("water");
    expect(words).not.toContain("victoria");
    expect(words).not.toContain("minecraft");
  });

  it("keeps a pool name's word readable where it is part of a name that shows a figure", () => {
    // "rainier" is Mount Rainier (#20), "sapiens" the book (#66): those readings stay.
    expect(words).not.toContain("rainier");
    expect(words).not.toContain("sapiens");
  });

  it("still lists ordinary words of ranked names that name nothing themselves", () => {
    expect(words).toContain("mount");
  });
});
