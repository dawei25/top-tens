import { describe, expect, it } from "vitest";
import { fnv } from "./junk";
import { judgeGuess, normalize } from "./match";
import type { Entry, Puzzle } from "./types";

const e = (rank: number, name: string, aliases: string[] = []): Entry => ({ rank, name, aliases });

const puzzle: Puzzle = {
  id: "test",
  title: "Most populous countries",
  prompt: "Name the 10 most populous countries",
  source: { name: "Wikipedia", url: "", asOf: "2026-01-01" },
  answers: [
    e(1, "India"),
    e(2, "China", ["People's Republic of China", "PRC"]),
    e(3, "United States", ["USA", "US", "America", "United States of America"]),
    e(4, "Indonesia"),
    e(5, "Pakistan"),
    e(6, "Nigeria"),
    e(7, "Brazil"),
    e(8, "Bangladesh"),
    e(9, "Russia", ["Russian Federation"]),
    e(10, "Ethiopia"),
  ],
  extras: [e(11, "Mexico"), e(17, "Iran"), e(19, "Germany"), e(36, "Iraq"), e(37, "Niger")],
};

const judge = (g: string, found: number[] = []) => judgeGuess(g, puzzle, new Set(found));

describe("normalize", () => {
  it("strips case, accents, punctuation and leading articles", () => {
    expect(normalize("  The Côte d'Ivoire! ")).toBe("cote divoire");
    expect(normalize("U.S.A.")).toBe("usa");
    expect(normalize("Trinidad & Tobago")).toBe("trinidad and tobago");
  });
});

describe("judgeGuess", () => {
  it("accepts exact names and aliases", () => {
    expect(judge("india")).toMatchObject({ kind: "correct", corrected: false });
    expect(judge("USA")).toMatchObject({ kind: "correct", entry: { rank: 3 } });
    expect(judge("the united states of america")).toMatchObject({ kind: "correct", entry: { rank: 3 } });
  });

  it("autocorrects close misspellings", () => {
    expect(judge("Bangladesch")).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 8 } });
    expect(judge("Ethopia")).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 10 } });
    expect(judge("Indoneisa")).toMatchObject({ kind: "correct", entry: { rank: 4 } });
    expect(judge("Paskitsan")).toMatchObject({ kind: "correct", entry: { rank: 5 } });
  });

  it("does not let Nigeria and Niger collide", () => {
    expect(judge("Niger")).toMatchObject({ kind: "near", entry: { rank: 37 } });
    expect(judge("Nigeria")).toMatchObject({ kind: "correct", entry: { rank: 6 } });
  });

  it("asks for clarification when a typo is ambiguous", () => {
    const r = judge("Irak");
    expect(r.kind).toBe("typo");
  });

  it("flags duplicates without costing a life", () => {
    expect(judge("India", [1])).toMatchObject({ kind: "duplicate" });
    expect(judge("Indai", [1])).toMatchObject({ kind: "duplicate" });
  });

  it("reports ranks 11+ as near misses", () => {
    expect(judge("Mexico")).toMatchObject({ kind: "near", entry: { rank: 11 } });
    expect(judge("Germny")).toMatchObject({ kind: "near", corrected: true });
  });

  it("fills in a clear misspelling of one top-10 answer", () => {
    expect(judge("Packeestan")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Pakistan" } });
  });

  it("treats numbers as identity, not spelling", () => {
    const games: Puzzle = {
      ...puzzle,
      answers: [e(1, "Grand Theft Auto V", ["GTA V"]), e(2, "Mario Kart 8")],
      extras: [e(11, "Grand Theft Auto IV", ["GTA IV"]), e(12, "Grand Theft Auto: San Andreas")],
    };
    const g = (s: string) => judgeGuess(s, games, new Set());
    expect(g("gta5")).toMatchObject({ kind: "correct", entry: { rank: 1 } });
    expect(g("Grand Theft Auto 5")).toMatchObject({ kind: "correct", entry: { rank: 1 } });
    expect(g("gta 4")).toMatchObject({ kind: "near", entry: { rank: 11 } });
    expect(g("gta 6").kind).toBe("unknown");
    expect(g("mario kart 7").kind).toBe("unknown");
  });

  it("never credits a different real answer (Listable accepts Indonesia for India)", () => {
    const withoutIndonesia = { ...puzzle, answers: puzzle.answers.filter((a) => a.rank !== 4) };
    expect(judgeGuess("Indonesia", withoutIndonesia, new Set()).kind).toBe("unknown");
    expect(judgeGuess("Iran", puzzle, new Set())).toMatchObject({ kind: "near", entry: { name: "Iran" } });
  });

  it("lets anything that isn't an accepted answer through for free", () => {
    expect(judge("Japan")).toMatchObject({ kind: "unknown", junk: false });
    expect(judge("Elon Musk")).toMatchObject({ kind: "unknown", junk: false });
    expect(judge("asdfgh")).toMatchObject({ kind: "unknown", junk: true });
    expect(judge("qwerty")).toMatchObject({ kind: "unknown", junk: true });
    expect(judge("   ").kind).toBe("empty");
  });
});

describe("intent", () => {
  const islands: Puzzle = {
    id: "islands",
    title: "Largest islands",
    prompt: "",
    source: { name: "", url: "", asOf: "" },
    answers: [
      e(1, "Greenland"),
      e(2, "New Guinea"),
      e(3, "Borneo"),
      e(4, "Madagascar"),
      e(5, "Baffin Island", ["Baffin"]),
      e(6, "Sumatra"),
      e(7, "Honshu"),
      e(8, "Victoria Island"),
      e(9, "Great Britain", ["UK", "United Kingdom"]),
      e(10, "Ellesmere Island"),
    ],
    extras: [
      e(12, "South Island", ["New Zealand"]),
      e(14, "North Island", ["New Zealand"]),
      e(0, "Faroe Islands"),
      e(30, "Tokyo Haneda Airport"),
    ],
  };
  const j = (s: string, found: number[] = []) => judgeGuess(s, islands, new Set(found));

  it("counts curated same-thing names", () => {
    expect(j("UK")).toMatchObject({ kind: "correct", entry: { name: "Great Britain" } });
    expect(j("united kingdom")).toMatchObject({ kind: "correct", entry: { name: "Great Britain" } });
  });

  it("offers every entry behind a shared name, alphabetically", () => {
    expect(j("New Zealand")).toEqual({ kind: "typo", suggestions: ["North Island", "South Island"] });
  });

  it("accepts unranked real answers", () => {
    expect(j("Faroe Islands")).toMatchObject({ kind: "near", entry: { rank: 0 } });
  });

  it("puts a distinctive word from a longer name in the box to confirm", () => {
    expect(j("Haneda")).toMatchObject({ kind: "near", corrected: true, entry: { name: "Tokyo Haneda Airport" } });
    expect(j("Ellesmere")).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 10 } });
    expect(j("island").kind).toBe("unknown");
  });
});

describe("shared words are not typo evidence", () => {
  const peaks: Puzzle = {
    ...puzzle,
    answers: [e(1, "Mount Everest"), e(4, "Lhotse", ["Mount Lhotse"])],
    extras: [e(0, "Mount Elbrus")],
  };
  const j = (g: string) => judgeGuess(g, peaks, new Set());
  it("a different mountain sharing 'mount' is not corrected into a listed one", () => {
    expect(j("mount whitney").kind).toBe("unknown");
    expect(j("mount olympus").kind).toBe("unknown");
  });
  it("a real misspelling after the shared word still corrects", () => {
    expect(j("mount everst")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Mount Everest" } });
  });
});

describe("autocorrect doesn't hand out answers nobody typed", () => {
  const songs: Puzzle = {
    ...puzzle,
    id: "songs",
    answers: [e(1, "Blinding Lights"), e(2, "Shape of You"), ...puzzle.answers.slice(2)],
    extras: [e(11, "Don't Bother Me, I Can't Cope"), e(12, "Castries"), e(13, "Kareem Abdul-Jabbar")],
  };
  const j = (g: string) => judgeGuess(g, songs, new Set());
  it("a different short word is not a typo of one word in a long name", () => {
    expect(j("pope")).toMatchObject({ kind: "unknown" });
  });
  it("a misspelling past one slip keeps its first letter", () => {
    expect(j("factories")).toMatchObject({ kind: "unknown" });
  });
  it("near-exact misspellings still land, on whole names and on words of names", () => {
    expect(j("kareen")).toMatchObject({ kind: "near", entry: { name: "Kareem Abdul-Jabbar" }, corrected: true });
    expect(j("blindng lihgts")).toMatchObject({ kind: "correct", entry: { rank: 1 }, corrected: true });
    expect(j("bangledesh")).toMatchObject({ kind: "correct", entry: { rank: 8 } });
  });
});

describe("a whole name beats a word of a longer name at the same distance", () => {
  const peaks: Puzzle = {
    ...puzzle,
    id: "peaks",
    answers: [e(1, "Mount Everest", ["Everest"]), e(2, "K2"), e(3, "Kangchenjunga"), e(4, "Lhotse"), ...puzzle.answers.slice(4)],
    extras: [e(0, "Lhotse Middle"), e(0, "Lhotse Shar")],
  };
  it("corrects a misspelling to the peak itself, not a choice of its side summits", () => {
    expect(judgeGuess("lotse", peaks, new Set())).toMatchObject({ kind: "correct", entry: { rank: 4 }, corrected: true });
  });
});

describe("several names containing the guess", () => {
  const states: Puzzle = {
    ...puzzle,
    id: "states",
    answers: [
      e(1, "California"), e(2, "Texas"), e(3, "Florida"), e(4, "New York"), e(5, "Pennsylvania"),
      e(6, "Illinois"), e(7, "Ohio"), e(8, "Georgia"), e(9, "North Carolina"), e(10, "Michigan"),
    ],
    extras: [e(28, "South Carolina"), e(47, "North Dakota"), e(46, "South Dakota")],
  };
  const games: Puzzle = {
    ...puzzle,
    id: "games",
    answers: [e(1, "Minecraft"), e(2, "Mario Kart 8"), ...puzzle.answers.slice(2)],
    extras: [e(0, "Mario Kart Wii"), e(0, "Mario Kart World"), e(0, "Mario Kart Arcade GP"), e(0, "Destroy All Humans!"), e(0, "Destroy All Humans! 2")],
  };
  it("offers them when the guess is what each is called (North and South Carolina)", () => {
    expect(judgeGuess("carolina", states, new Set())).toMatchObject({ kind: "typo", suggestions: ["North Carolina", "South Carolina"] });
    expect(judgeGuess("dakota", states, new Set())).toMatchObject({ kind: "typo", suggestions: ["North Dakota", "South Dakota"] });
  });
  it("takes the natural reading: the most prominent name, then the next once that one is found", () => {
    expect(judgeGuess("mario kart", games, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Mario Kart 8" } });
    // Mario Kart 8 found: the rest are unranked equals, so they're offered.
    expect(judgeGuess("mario kart", games, new Set([2]))).toMatchObject({ kind: "typo" });
    expect(judgeGuess("humans", games, new Set())).toMatchObject({ kind: "typo", suggestions: ["Destroy All Humans!", "Destroy All Humans! 2"] });
  });
  it("still takes one name's distinctive word as that entry", () => {
    expect(judgeGuess("minecraft", games, new Set())).toMatchObject({ kind: "correct", entry: { rank: 1 } });
    expect(judgeGuess("york", states, new Set())).toMatchObject({ kind: "correct", entry: { rank: 4 } });
  });
});

describe("six or seven letters get two edits", () => {
  const places: Puzzle = {
    ...puzzle,
    id: "places",
    answers: [e(1, "Poland"), e(2, "Montana"), e(3, "Hungary"), e(4, "Morocco"), e(5, "Phoenix"), ...puzzle.answers.slice(5)],
    extras: [e(11, "Charli D'Amelio", ["Charli"])],
  };
  const j = (g: string) => judgeGuess(g, places, new Set());
  it("an ordinary word three changes away is not a misspelling", () => {
    expect(j("planes")).toMatchObject({ kind: "unknown" });
    expect(j("church")).toMatchObject({ kind: "unknown" });
    expect(j("mountain")).toMatchObject({ kind: "unknown" });
  });
  it("real slips still land", () => {
    expect(j("hungery")).toMatchObject({ kind: "correct", entry: { rank: 3 }, corrected: true });
    expect(j("marocco")).toMatchObject({ kind: "correct", entry: { rank: 4 }, corrected: true });
    expect(j("pheonix")).toMatchObject({ kind: "correct", entry: { rank: 5 }, corrected: true });
    expect(j("polnad")).toMatchObject({ kind: "correct", entry: { rank: 1 }, corrected: true });
  });
});

describe("leaks the list judges found", () => {
  const moons: Puzzle = {
    ...puzzle,
    id: "moons",
    answers: [
      e(1, "Ganymede"), e(2, "Titan", ["Saturn VI"]), e(3, "Callisto"), e(4, "Io", ["Satellite Io", "Jupiter I"]),
      e(5, "Moon"), e(6, "Europa"), e(7, "Triton", ["Neptune I"]), e(8, "Titania", ["Uranus III"]), e(9, "Rhea", ["Saturn V"]),
      e(10, "Oberon", ["Uranus IV"]),
    ],
    extras: [],
  };
  const world: Puzzle = {
    ...puzzle,
    id: "world",
    extras: [...puzzle.extras, e(0, "American Samoa"), e(0, "South Africa"), e(0, "Ireland", ["Irlanda", "Irland"]), e(0, "Cars 2")],
  };
  it("a name with whole words added or dropped is not a misspelling (Neptune I, Uranus III, Satellite Io)", () => {
    for (const g of ["neptune", "uranus", "saturn", "satellite"]) expect(judgeGuess(g, moons, new Set())).toMatchObject({ kind: "unknown" });
    expect(judgeGuess("cars", world, new Set())).toMatchObject({ kind: "near", corrected: true, entry: { name: "Cars 2" } });
  });
  it("a word that is only part of a name asks before it costs a life", () => {
    expect(judgeGuess("american", world, new Set())).toMatchObject({ kind: "near", corrected: true, entry: { name: "American Samoa" } });
    expect(judgeGuess("africa", world, new Set())).toMatchObject({ kind: "near", corrected: true, entry: { name: "South Africa" } });
  });
  it("a plain category word is never corrected into an answer", () => {
    expect(judgeGuess("islands", world, new Set())).toMatchObject({ kind: "unknown" });
  });
});

describe("an exact title that is the less likely reading", () => {
  const films: Puzzle = {
    ...puzzle,
    id: "films",
    answers: [e(1, "Avengers: Endgame"), e(2, "Avatar"), e(3, "Avatar: The Way of Water"), ...puzzle.answers.slice(3)],
    extras: [e(15, "The Avengers"), e(0, "Frozen")],
  };
  it("offers the likelier answer that carries the same name, free", () => {
    expect(judgeGuess("avengers", films, new Set())).toMatchObject({ kind: "typo", suggestions: ["Avengers: Endgame", "The Avengers"] });
  });
  it("still counts an exact title that is itself the likely reading", () => {
    expect(judgeGuess("avatar", films, new Set())).toMatchObject({ kind: "correct", corrected: false, entry: { rank: 2 } });
  });
  it("once the likelier one is found, the exact title is the reading", () => {
    expect(judgeGuess("avengers", films, new Set([1]))).toMatchObject({ kind: "near", entry: { name: "The Avengers" } });
  });
});

describe("an answer's name followed by who made it", () => {
  const songs: Puzzle = {
    ...puzzle,
    id: "songs2",
    answers: [e(1, "Blinding Lights"), e(2, "Shape of You"), e(3, "Stay"), e(4, "Perfect"), ...puzzle.answers.slice(4)],
    extras: [],
  };
  it("puts that answer in the box to confirm", () => {
    expect(judgeGuess("perfect ed sheeran", songs, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Perfect" } });
    expect(judgeGuess("shape of you by ed sheeran", songs, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 2 } });
    expect(judgeGuess("stay justin bieber", songs, new Set())).toMatchObject({ kind: "correct", entry: { name: "Stay" } });
  });
  it("not when a number after the name names a different one", () => {
    const films: Puzzle = { ...puzzle, id: "films5", answers: [e(1, "Frozen"), e(2, "Bridgerton Season 1", ["Bridgerton"]), ...puzzle.answers.slice(2)], extras: [] };
    expect(judgeGuess("frozen 3", films, new Set()).kind).toBe("unknown");
    expect(judgeGuess("frozen three", films, new Set()).kind).toBe("unknown");
    expect(judgeGuess("bridgerton 2", films, new Set()).kind).toBe("unknown");
    expect(judgeGuess("bridgerton season 1 netflix", films, new Set())).toMatchObject({ kind: "correct", entry: { rank: 2 } });
  });
  it("needs a real name at the start, not a scrap of one", () => {
    expect(judgeGuess("sta justin bieber", songs, new Set())).toMatchObject({ kind: "unknown" });
  });
  it("an artist with several entries: the rest of the guess picks one", () => {
    const tours: Puzzle = {
      ...puzzle,
      id: "tours2",
      answers: [
        e(1, "The Eras Tour", ["Taylor Swift"]),
        e(2, "Music of the Spheres World Tour", ["Coldplay"]),
        e(3, "Mathematics Tour", ["Ed Sheeran"]),
        e(4, "Divide Tour", ["Ed Sheeran"]),
        ...puzzle.answers.slice(4),
      ],
      extras: [e(18, "A Head Full of Dreams Tour", ["Coldplay"])],
    };
    expect(judgeGuess("ed sheeran divide", tours, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 4 } });
    expect(judgeGuess("coldplay a head full of dreams", tours, new Set())).toMatchObject({ kind: "near", entry: { rank: 18 } });
    expect(judgeGuess("ed sheeran tour", tours, new Set())).toMatchObject({ kind: "correct", entry: { rank: 3 } });
  });
  it("words of a name in order, with some left out, are that name", () => {
    const tours: Puzzle = {
      ...puzzle,
      id: "tours3",
      answers: [e(1, "Renaissance World Tour"), e(2, "The Lord of the Rings: The Return of the King"), ...puzzle.answers.slice(2)],
      extras: [e(0, "The 1989 World Tour")],
    };
    expect(judgeGuess("renaissance tour", tours, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 1 } });
    expect(judgeGuess("lord rings", tours, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 2 } });
    expect(judgeGuess("1989 tour", tours, new Set())).toMatchObject({ kind: "near", entry: { name: "The 1989 World Tour" } });
    // Out of order, or one distinctive word with a generic one, is not.
    expect(judgeGuess("tour renaissance", tours, new Set()).kind).toBe("unknown");
  });
  it("a short shared name picks by the rest, and alone is not a lead", () => {
    const tours: Puzzle = {
      ...puzzle,
      id: "tours4",
      answers: [e(1, "U2 360° Tour", ["U2"]), ...puzzle.answers.slice(1)],
      extras: [e(14, "Vertigo Tour", ["U2"]), e(20, "The Joshua Tree Tour 2017", ["U2"])],
    };
    expect(judgeGuess("u2 vertigo", tours, new Set())).toMatchObject({ kind: "near", entry: { name: "Vertigo Tour" } });
    expect(judgeGuess("u2 joshua tree", tours, new Set())).toMatchObject({ kind: "near", entry: { rank: 20 } });
    expect(judgeGuess("u2 elephant", tours, new Set()).kind).toBe("unknown");
  });
  it("not when the whole guess is a name of its own", () => {
    const countries: Puzzle = { ...puzzle, id: "countries3", answers: [e(1, "Saudi Arabia"), e(2, "Mexico"), ...puzzle.answers.slice(2)], extras: [] };
    // A lexicon that knows "Saudi Aramco" and "Mexico City" as names (from other lists in the bank).
    const lex = { alphabet: "", table: "", names: ["saudi aramco", "mexico city"].map((w) => fnv(w).toString(36)).join(" ") };
    expect(judgeGuess("saudi aramco", countries, new Set(), lex)).toMatchObject({ kind: "unknown" });
    expect(judgeGuess("mexico city", countries, new Set(), lex)).toMatchObject({ kind: "unknown" });
    expect(judgeGuess("saudi arabia riyadh", countries, new Set(), lex)).toMatchObject({ kind: "correct", entry: { rank: 1 } });
  });
});

describe("an ordinary word typed alone", () => {
  const games: Puzzle = {
    ...puzzle,
    id: "games2",
    answers: [e(1, "Minecraft"), e(2, "Mario Kart 8"), ...puzzle.answers.slice(2)],
    extras: [e(0, "Destroy All Humans!"), e(0, "Destroy All Humans! 2"), e(0, "Kevin Durant"), e(0, "Walter Masterson")],
  };
  // A lexicon whose word list holds "humans" and "water" (and nothing marks them as names).
  const lex = { alphabet: "", table: "", names: "", words: ["humans", "water"].map((w) => fnv(w).toString(36)).join(" ") };
  it("is not read as part of a longer name", () => {
    expect(judgeGuess("humans", games, new Set(), lex)).toMatchObject({ kind: "unknown" });
    expect(judgeGuess("water", games, new Set(), lex)).toMatchObject({ kind: "unknown" });
  });
  it("while names and partial names still are", () => {
    expect(judgeGuess("kevin", games, new Set(), lex)).toMatchObject({ entry: { name: "Kevin Durant" }, corrected: true });
    expect(judgeGuess("minecraft", games, new Set(), lex)).toMatchObject({ kind: "correct", entry: { rank: 1 } });
  });
  it("is never stretched into a name: one slip at most, onto a ranked answer", () => {
    const countries: Puzzle = { ...puzzle, id: "countries4", answers: [e(1, "Brazil"), ...puzzle.answers.slice(1)], extras: [e(40, "Hungary"), e(0, "Nice")] };
    const lex2 = { ...lex, words: ["barrel", "hungry", "rice"].map((w) => fnv(w).toString(36)).join(" ") };
    expect(judgeGuess("barrel", countries, new Set(), lex2)).toMatchObject({ kind: "unknown" });
    expect(judgeGuess("rice", countries, new Set(), lex2)).toMatchObject({ kind: "unknown" });
    expect(judgeGuess("hungry", countries, new Set(), lex2)).toMatchObject({ kind: "near", entry: { name: "Hungary" }, corrected: true });
    const dogs: Puzzle = { ...puzzle, id: "dogs5", answers: [e(1, "Poodle"), ...puzzle.answers.slice(1)], extras: [] };
    const lex3 = { ...lex, words: ["doodle"].map((w) => fnv(w).toString(36)).join(" ") };
    expect(judgeGuess("doodle", dogs, new Set(), lex3).kind).toBe("unknown");
  });
  it("and an entry named exactly that word still matches", () => {
    const withWater: Puzzle = { ...games, extras: [...games.extras, e(0, "Water")] };
    expect(judgeGuess("water", withWater, new Set(), lex)).toMatchObject({ kind: "near", entry: { name: "Water" }, corrected: false });
  });
});

describe("number words", () => {
  const films: Puzzle = {
    ...puzzle,
    id: "films2",
    answers: [e(1, "Frozen II"), e(2, "Inside Out 2"), e(3, "One Piece Film: Red"), ...puzzle.answers.slice(3)],
    extras: [e(12, "Frozen"), e(13, "Inside Out"), e(0, "One Direction")],
  };
  const j = (g: string) => judgeGuess(g, films, new Set());
  it("count as their digits", () => {
    expect(j("frozen two")).toMatchObject({ kind: "correct", entry: { rank: 1 } });
    expect(j("inside out two")).toMatchObject({ kind: "correct", entry: { rank: 2 } });
  });
  it("still match names spelled with words", () => {
    expect(j("one direction")).toMatchObject({ kind: "near", entry: { name: "One Direction" } });
    // Plain "frozen" is the less prominent film, so the sequel is offered too.
    expect(j("frozen")).toMatchObject({ kind: "typo", suggestions: ["Frozen", "Frozen II"] });
  });
});

describe("a word that fits a crowd", () => {
  const names = ["Eras", "Spheres", "Farewell", "Divide", "Mathematics", "Renaissance", "Love On", "M72", "Summer", "Joshua Tree", "Vertigo", "Bigger Bang"];
  const tours: Puzzle = {
    ...puzzle,
    id: "tours5",
    answers: names.slice(0, 10).map((n, i) => e(i + 1, `${n} World Tour`)),
    extras: names.slice(10).map((n, i) => e(i + 11, `${n} World Tour`)),
  };
  it("asks for more, rather than handing over the top 10 a few at a time", () => {
    expect(judgeGuess("tour", tours, new Set())).toMatchObject({ kind: "unknown", vague: 12 });
    expect(judgeGuess("world tour", tours, new Set())).toMatchObject({ kind: "unknown" });
    expect(judgeGuess("tour", tours, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toMatchObject({ kind: "unknown" });
  });
  it("as does a word three top-10 answers share, while two are a choice", () => {
    const cars: Puzzle = {
      ...puzzle,
      id: "cars5",
      answers: [e(1, "Toyota Corolla"), e(2, "Ford F-Series"), e(3, "Volkswagen Golf"), e(4, "Toyota Camry"), e(5, "Ford Fiesta"), e(6, "Toyota Hilux"), ...puzzle.answers.slice(6)],
      extras: [e(0, "Toyota Prius")],
    };
    expect(judgeGuess("toyota", cars, new Set())).toMatchObject({ kind: "unknown", vague: 4 });
    expect(judgeGuess("ford", cars, new Set())).toMatchObject({ kind: "typo", suggestions: ["Ford F-Series", "Ford Fiesta"] });
    expect(judgeGuess("toyota corolla", cars, new Set())).toMatchObject({ kind: "correct", entry: { rank: 1 } });
  });
  it("while a distinctive word still finds its entry", () => {
    expect(judgeGuess("renaissance tour", tours, new Set())).toMatchObject({ kind: "correct", entry: { rank: 6 } });
    expect(judgeGuess("vertigo", tours, new Set())).toMatchObject({ kind: "near", entry: { rank: 11 } });
  });
});

describe("cycle 5 readings", () => {
  const seasons: Puzzle = {
    ...puzzle,
    id: "seasons5",
    noun: "Netflix series",
    answers: [e(1, "Squid Game (Season 1)", ["Squid Game"]), e(2, "Wednesday (Season 1)", ["Wednesday"]), e(3, "Squid Game (Season 2)"), e(4, "Squid Game (Season 3)"), ...puzzle.answers.slice(4)],
    extras: [e(0, "Our Planet"), e(0, "The 1989 World Tour")],
  };
  it("a small number with the list's subject names no entry", () => {
    expect(judgeGuess("season 3", seasons, new Set()).kind).toBe("unknown");
    expect(judgeGuess("season", seasons, new Set()).kind).toBe("unknown");
    expect(judgeGuess("squid game 3", seasons, new Set())).toMatchObject({ kind: "correct", entry: { rank: 4 } });
  });
  it("an obscure pool name takes a slip only in the middle; a name with a figure takes the usual ones", () => {
    expect(judgeGuess("planes", seasons, new Set()).kind).toBe("unknown");
    const films: Puzzle = { ...puzzle, id: "films6", extras: [{ rank: 0, name: "Titanic", aliases: [], value: "$200 million" }] };
    expect(judgeGuess("titanik", films, new Set())).toMatchObject({ kind: "near", entry: { name: "Titanic" }, corrected: true });
  });
  it("a slip in a short first name beside the right surname is a slip", () => {
    const athletes: Puzzle = { ...puzzle, id: "athletes5", answers: [e(1, "Jon Rahm"), ...puzzle.answers.slice(1)], extras: [] };
    expect(judgeGuess("john rahm", athletes, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 1 } });
  });
  it("a short name with the rest naming its only entry, and category words for music", () => {
    const tours: Puzzle = {
      ...puzzle,
      id: "tours6",
      noun: "concert tours",
      answers: [e(1, "Music of the Spheres World Tour", ["Coldplay"]), e(2, "Born in the U.S.A. Tour", ["E Street Band"]), ...puzzle.answers.slice(2)],
      extras: [e(19, "Arirang World Tour", ["BTS"])],
    };
    expect(judgeGuess("bts arirang", tours, new Set())).toMatchObject({ kind: "near", entry: { rank: 19 } });
    expect(judgeGuess("music", tours, new Set()).kind).toBe("unknown");
    expect(judgeGuess("band", tours, new Set()).kind).toBe("unknown");
    expect(judgeGuess("e street band", tours, new Set())).toMatchObject({ kind: "correct", entry: { rank: 2 } });
    expect(judgeGuess("spheres", tours, new Set())).toMatchObject({ entry: { rank: 1 } });
  });
});

describe("cycle 6 readings", () => {
  const lex = {
    alphabet: "",
    table: "",
    names: ["goldendoodle"].map((w) => fnv(w).toString(36)).join(" "),
    words: ["steel", "swift", "story"].map((w) => fnv(w).toString(36)).join(" "),
  };
  it("a plain word stays readable on the list where a notable entry carries it", () => {
    const parks: Puzzle = { ...puzzle, id: "parks6", extras: [e(0, "Steel Pier")] };
    const artists: Puzzle = { ...puzzle, id: "artists6", answers: [e(1, "Taylor Swift"), ...puzzle.answers.slice(1)], extras: [e(0, "Steel Pulse")] };
    expect(judgeGuess("steel", parks, new Set(), lex).kind).toBe("unknown");
    expect(judgeGuess("swift", artists, new Set(), lex)).toMatchObject({ kind: "correct", entry: { name: "Taylor Swift" } });
    expect(judgeGuess("steel", artists, new Set(), lex).kind).toBe("unknown");
  });
  it("a name of its own however it's spaced, and part of a name followed by someone else's", () => {
    const dogs: Puzzle = { ...puzzle, id: "dogs6", answers: [e(1, "Golden Retriever", ["Golden"]), ...puzzle.answers.slice(1)], extras: [] };
    expect(judgeGuess("golden doodle", dogs, new Set(), lex).kind).toBe("unknown");
    expect(judgeGuess("golden", dogs, new Set(), lex)).toMatchObject({ kind: "correct", entry: { rank: 1 } });
    const tiktok: Puzzle = { ...puzzle, id: "tiktok6", answers: [e(1, "Charli D'Amelio", ["Charli"]), ...puzzle.answers.slice(1)], extras: [] };
    expect(judgeGuess("charli xcx", tiktok, new Set()).kind).toBe("unknown");
    expect(judgeGuess("charli", tiktok, new Set())).toMatchObject({ kind: "correct", entry: { rank: 1 } });
  });
  it("seasons by ordinal, and a show's other seasons or a plain word aren't its top season", () => {
    const shows: Puzzle = {
      ...puzzle,
      id: "shows6",
      noun: "Netflix series",
      answers: [
        e(1, "Squid Game (Season 1)", ["Squid Game"]),
        e(2, "Squid Game (Season 2)", ["Squid Game 2"]),
        e(3, "Stranger Things (Season 4)", ["Stranger Things", "Stranger Things 4"]),
        e(4, "Monster: The Jeffrey Dahmer Story", ["Monster", "Dahmer"]),
        ...puzzle.answers.slice(4),
      ],
      extras: [],
    };
    expect(judgeGuess("squid game second season", shows, new Set())).toMatchObject({ kind: "correct", entry: { rank: 2 } });
    expect(judgeGuess("second season of squid game", shows, new Set())).toMatchObject({ kind: "correct", entry: { rank: 2 } });
    expect(judgeGuess("stranger things final season", shows, new Set()).kind).toBe("unknown");
    expect(judgeGuess("monster menendez", shows, new Set()).kind).toBe("unknown");
    expect(judgeGuess("story", shows, new Set(), lex).kind).toBe("unknown");
  });
});
