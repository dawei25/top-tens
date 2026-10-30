import { describe, expect, it } from "vitest";
import { bareWord, gluedAlias, junkRedirect } from "./aliases";

const junk = (raw: string, names: string[], forms: string[] = [], works = false) => junkRedirect(raw, { names, forms, works });

describe("junkRedirect", () => {
  it("drops redirects about an aspect of the thing", () => {
    expect(junk("Child abuse in Saudi Arabia", ["Saudi Arabia"])).not.toBeNull();
    expect(junk("Law of Iran", ["Iran"])).not.toBeNull();
    expect(junk("Topography of the UK", ["United Kingdom"], ["UK"])).not.toBeNull();
    expect(junk("Transportation in New Mexico", ["New Mexico"])).not.toBeNull();
    expect(junk("Disappearing Glaciers in Glacier National Park", ["Glacier", "Glacier National Park"])).not.toBeNull();
  });

  it("keeps names that have 'of' in them", () => {
    expect(junk("State of Kuwait", ["Kuwait"])).toBeNull();
    expect(junk("United States of America", ["United States"])).toBeNull();
    expect(junk("Islamic Republic of Iran", ["Iran"])).toBeNull();
    expect(junk("P.R. of China", ["China"])).toBeNull();
    expect(junk("Saban Field at Bryant–Denny Stadium", ["Bryant–Denny Stadium"])).toBeNull();
    expect(junk("Legend of Zelda", ["The Legend of Zelda"], ["Zelda"])).toBeNull();
    expect(junk("Oracle of Omaha", ["Warren Buffett"])).toBeNull();
  });

  it("drops events, parts and topics, unless the name uses the word", () => {
    expect(junk("1937 Nanga Parbat tragedy", ["Nanga Parbat"])).not.toBeNull();
    expect(junk("Yellowstone Act", ["Yellowstone", "Yellowstone National Park"])).not.toBeNull();
    expect(junk("Glacier National Park Act of 1914", ["Glacier"])).not.toBeNull();
    expect(junk("Makalu Base Camp", ["Makalu"])).not.toBeNull();
    expect(junk("Southeast ridge", ["Mount Everest"])).not.toBeNull();
    expect(junk("Irish politics", ["Ireland"])).not.toBeNull();
    expect(junk("Nou Camp", ["Camp Nou"])).toBeNull();
    expect(junk("Natural History Museum London", ["Natural History Museum"])).toBeNull();
    expect(junk("Blade Runner 2049 film", ["Blade Runner 2049"])).toBeNull();
  });

  it("drops descriptions, sort keys and parts named in a qualifier", () => {
    expect(junk("Highest mountain in Asia", ["Mount Everest"])).not.toBeNull();
    expect(junk("Tale of Two Cities, A", ["A Tale of Two Cities"])).not.toBeNull();
    expect(junk("Musk, Elon", ["Elon Musk"])).not.toBeNull();
    expect(junk("City (Alaska)", ["Alaska"])).not.toBeNull();
    expect(junk("Wonderful (Wicked song)", ["Wicked"])).not.toBeNull();
    expect(junk("America (United States)", ["United States"])).toBeNull();
    expect(junk("Twitter (X)", ["X"])).toBeNull();
    expect(junk("Alaska (state)", ["Alaska"])).toBeNull();
  });

  it("on works, drops redirects sharing no word with the title (songs, characters)", () => {
    expect(junk("Think of Me", ["The Phantom of the Opera"], [], true)).not.toBeNull();
    expect(junk("Leigh Teabing", ["The Da Vinci Code"], [], true)).not.toBeNull();
    expect(junk("Les Mis", ["Les Misérables"], [], true)).toBeNull();
    expect(junk("Mama Mia", ["Mamma Mia!"], [], true)).toBeNull();
    expect(junk("GTA V", ["Grand Theft Auto V"], [], true)).toBeNull();
    expect(junk("RDR2", ["Red Dead Redemption 2"], [], true)).toBeNull();
    expect(junk("GTAV", ["Grand Theft Auto V"], [], true)).toBeNull();
    expect(junk("TESV", ["The Elder Scrolls V: Skyrim"], [], true)).toBeNull();
    // Not works: nicknames stay.
    expect(junk("Pocket Monsters", ["Pokémon"])).toBeNull();
  });
});

describe("bareWord and gluedAlias", () => {
  const places = new Set(["australia", "michigan"]);
  it("flags one plain word or place", () => {
    expect(bareWord("Salt", places)).toBe(true);
    expect(bareWord("Australia", places)).toBe(true);
    expect(bareWord("Baikal", places)).toBe(false);
    expect(bareWord("Great Bear", places)).toBe(false);
    expect(bareWord("Gap", places)).toBe(false);
  });
  it("finds names glued without spaces", () => {
    const forms = ["Mount Everest", "Sagarmatha"];
    expect(gluedAlias("Mount EverestSagarmathaChomolungma", forms)).toBe(true);
    expect(gluedAlias("Gasherbrum IIK4", ["Gasherbrum II", "K4"])).toBe(true);
    expect(gluedAlias("LeBronJames", ["LeBron James", "LeBron", "James"])).toBe(false);
    expect(gluedAlias("Mount Everest", forms)).toBe(false);
    expect(gluedAlias("Lotte World 2", ["Lotte World"])).toBe(false);
  });
});
