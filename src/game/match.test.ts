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

describe("a franchise's name shared by a top-10 title and a notable near miss", () => {
  const v = (rank: number, name: string, value: string, aliases: string[] = []): Entry => ({ rank, name, aliases, value });
  const pixar: Puzzle = {
    ...puzzle,
    id: "pixar7",
    noun: "Pixar films",
    answers: [v(1, "Inside Out 2", "$1.70 billion"), ...puzzle.answers.slice(1, 9), v(10, "Monsters University", "$744 million")],
    extras: [v(14, "Monsters, Inc.", "$580 million", ["Monsters Incorporated"]), v(15, "Cars 2", "$560 million"), e(0, "Monsters at Work")],
  };
  const j = (g: string, found: number[] = []) => judgeGuess(g, pixar, new Set(found));
  it("offers both films rather than steering to the higher-grossing one (player's note: \"monsters\")", () => {
    expect(j("monsters")).toEqual({ kind: "typo", suggestions: ["Monsters at Work", "Monsters University", "Monsters, Inc."] });
    // Once Monsters University is found, the other one is the reading.
    expect(j("monsters", [10])).toMatchObject({ kind: "near", corrected: true, entry: { name: "Monsters, Inc." } });
    // A full name is still that film.
    expect(j("monsters university")).toMatchObject({ kind: "correct", corrected: false, entry: { rank: 10 } });
    expect(j("monsters inc")).toMatchObject({ kind: "near", corrected: false, entry: { rank: 14 } });
  });
  it("still takes the top-10 one when the others are obscure or far down", () => {
    const far: Puzzle = { ...pixar, extras: [v(31, "Monsters, Inc.", "$580 million"), e(0, "Monsters at Work")] };
    expect(judgeGuess("monsters", far, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { rank: 10 } });
  });
  it("people keep the natural reading: a surname or a first name is not a franchise", () => {
    const nba: Puzzle = {
      ...puzzle,
      id: "nba7",
      answers: [...puzzle.answers.slice(0, 5), v(6, "Michael Jordan", "32,292"), ...puzzle.answers.slice(6)],
      extras: [v(14, "DeAndre Jordan", "20,000")],
    };
    expect(judgeGuess("jordan", nba, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Michael Jordan" } });
    // A first name before a surname that stands alone (the build gives ranked people their surname as a short form).
    const qbs: Puzzle = {
      ...puzzle,
      id: "qbs7",
      answers: [puzzle.answers[0], v(2, "Drew Brees", "80,358", ["Brees"]), ...puzzle.answers.slice(2)],
      extras: [v(14, "Drew Bledsoe", "44,611", ["Bledsoe"])],
    };
    expect(judgeGuess("drew", qbs, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Drew Brees" } });
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
  it("even when one of them is called that once a qualifier is dropped (Central Coast)", () => {
    const cities: Puzzle = {
      ...puzzle,
      id: "cities14",
      answers: [...puzzle.answers.slice(0, 5), e(6, "Gold Coast"), ...puzzle.answers.slice(6, 8), e(9, "Sunshine Coast"), e(10, "Central Coast")],
      extras: [],
    };
    expect(judgeGuess("coast", cities, new Set())).toMatchObject({ kind: "unknown", vague: 3 });
    expect(judgeGuess("the coast", cities, new Set())).toMatchObject({ kind: "unknown", vague: 3 });
    expect(judgeGuess("central coast", cities, new Set())).toMatchObject({ kind: "correct", corrected: false, entry: { rank: 10 } });
    // Two are still a choice of equals: North and South Carolina (above).
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

// Coverage audit (Nov 8): 112 lists played, about 6,000 guesses. These are the matching rules that misfired across
// many lists; each case below failed before its rule.
describe("coverage audit readings", () => {
  const h = (...ws: string[]) => ws.map((w) => fnv(w).toString(36)).join(" ");
  const lexOf = (l: { names?: string[]; words?: string[]; slips?: [string, string][]; people?: string[]; countries?: [string, string][] }) => ({
    alphabet: "",
    table: "",
    names: h(...(l.names ?? [])),
    words: h(...(l.words ?? [])),
    slips: h(...(l.slips ?? []).map(([a, b]) => `${a}>${b}`)),
    people: h(...(l.people ?? [])),
    countries: (l.countries ?? []).map(([f, c]) => `${fnv(f).toString(36)}:${fnv(c).toString(36)}`).join(" "),
  });
  const v = (rank: number, name: string, aliases: string[] = [], value = "1"): Entry => ({ rank, name, aliases, value });

  it("a known real name that isn't an answer says so (class 1)", () => {
    const funds: Puzzle = { ...puzzle, id: "funds9", noun: "firms", answers: [e(1, "Bridgewater Associates"), ...puzzle.answers.slice(1)], extras: [] };
    const lex = lexOf({ names: ["point72"] });
    expect(judgeGuess("Point72", funds, new Set(), lex)).toEqual({ kind: "unknown", junk: false, known: true });
    expect(judgeGuess("Pointy McPoint", funds, new Set(), lex)).toEqual({ kind: "unknown", junk: false });
  });

  it("a misspelling another list stores as an alias still corrects to its own entry (class 2)", () => {
    const countries: Puzzle = { ...puzzle, id: "countries9", extras: [v(40, "Afghanistan"), v(120, "Ireland"), v(150, "Austria"), v(0, "Kiel")] };
    const lex = lexOf({ names: ["afganistan", "irland", "australia", "kiev"], slips: [["afganistan", "afghanistan"], ["irland", "ireland"], ["kiev", "kyiv"]] });
    expect(judgeGuess("afganistan", countries, new Set(), lex)).toMatchObject({ kind: "near", corrected: true, entry: { name: "Afghanistan" } });
    expect(judgeGuess("irland", countries, new Set(), lex)).toMatchObject({ kind: "near", corrected: true, entry: { name: "Ireland" } });
    // A real name stays itself: "australia" is not corrected into Austria, and a slip of Kyiv is not one of Kiel.
    expect(judgeGuess("australia", countries, new Set(), lex)).toMatchObject({ kind: "unknown", known: true });
    expect(judgeGuess("kiev", countries, new Set(), lex)).toMatchObject({ kind: "unknown" });
    // A stored misspelling is still as ambiguous as it looks: "Irak" offers Iran and Iraq (Fathom's name-it e2e), and
    // a closer different name never wins over the entry it misspells.
    const gulf: Puzzle = { ...puzzle, id: "gulf9", extras: [v(17, "Iran"), v(36, "Iraq"), v(0, "Kyiv"), v(0, "Kiel")] };
    const lex2 = lexOf({ names: ["irak", "kiev"], slips: [["irak", "iraq"], ["kiev", "kyiv"]] });
    expect(judgeGuess("irak", gulf, new Set(), lex2)).toEqual({ kind: "typo", suggestions: ["Iran", "Iraq"] });
    // Kiel is one slip from "kiev", Kyiv (the entry it misspells) two: Kiel never wins.
    expect(judgeGuess("kiev", gulf, new Set(), lex2)).toMatchObject({ kind: "unknown", known: true });
  });

  it("one slip on an ordinary word needs five letters or more (class 3)", () => {
    const farm: Puzzle = { ...puzzle, id: "farm9", answers: [e(1, "Rice"), e(2, "Pork", ["ham"]), ...puzzle.answers.slice(2)], extras: [e(29, "Czech Republic", ["ČR"]), e(40, "Hungary")] };
    const lex = lexOf({ words: ["hay", "car", "hungry"] });
    expect(judgeGuess("hay", farm, new Set(), lex).kind).toBe("unknown");
    expect(judgeGuess("car", farm, new Set(), lex).kind).toBe("unknown");
    expect(judgeGuess("hungry", farm, new Set(), lex)).toMatchObject({ kind: "near", corrected: true, entry: { name: "Hungary" } });
  });

  it("giving up is never an answer, and costs nothing (class 4)", () => {
    const nfl: Puzzle = {
      ...puzzle,
      id: "nfl9",
      answers: [e(1, "New England Patriots", ["Pats"]), e(2, "Nvidia"), ...puzzle.answers.slice(2)],
      extras: [v(24, "Warrick Dunn"), v(0, "Next Group")],
    };
    for (const g of ["pass", "dunno", "no idea", "idk", "skip", "next", "I don't know", "no clue", "?"]) {
      expect(judgeGuess(g, nfl, new Set()), g).toEqual({ kind: "unknown", junk: false, giveUp: true });
    }
    // Unless the list has an answer called exactly that: "whatever" is a password.
    const passwords: Puzzle = { ...puzzle, id: "passwords9", extras: [v(0, "whatever")] };
    expect(judgeGuess("whatever", passwords, new Set())).toMatchObject({ kind: "near", entry: { name: "whatever" } });
  });

  it("a correction never swaps a whole word the player typed for another (class 5)", () => {
    const sites: Puzzle = { ...puzzle, id: "sites9", extras: [v(39, "Stripchat"), e(0, "ShareChat"), v(50, "Pakistan Today")] };
    expect(judgeGuess("snapchat", sites, new Set()).kind).toBe("unknown");
    expect(judgeGuess("snap chat", sites, new Set()).kind).toBe("unknown");
    // Real slips still land, however far: a letter swapped, letters dropped, a vowel spelled by ear.
    expect(judgeGuess("stripchta", sites, new Set())).toMatchObject({ kind: "near", entry: { name: "Stripchat" } });
    expect(judgeGuess("Packeestan", puzzle, new Set())).toMatchObject({ kind: "correct", entry: { name: "Pakistan" } });
    const rivers: Puzzle = { ...puzzle, id: "rivers9", answers: [e(1, "Nile"), e(4, "Mississippi"), ...puzzle.answers.slice(2)], extras: [] };
    expect(judgeGuess("missisipi", rivers, new Set())).toMatchObject({ kind: "correct", entry: { name: "Mississippi" } });
  });

  it("a whole surname added to a one-word name is someone else (class 5)", () => {
    const pl: Puzzle = { ...puzzle, id: "pl9", extras: [v(0, "Fernando"), v(0, "José Torres", ["Torres"]), v(70, "Seven"), v(3, "Perfect")] };
    // "nation" and "army" are ordinary words (the lexicon's plain words), so they make a longer title, not who made it.
    const lex = lexOf({ names: ["ed sheeran", "torres", "adele"], words: ["nation", "army"] });
    expect(judgeGuess("fernando torres", pl, new Set(), lex).kind).toBe("unknown");
    expect(judgeGuess("seven nation army", pl, new Set(), lex).kind).toBe("unknown");
    // A title followed by who made it still reads as the title.
    expect(judgeGuess("perfect ed sheeran", pl, new Set(), lex)).toMatchObject({ kind: "near", entry: { name: "Perfect" } });
    expect(judgeGuess("perfect adele", pl, new Set(), lex)).toMatchObject({ kind: "near", entry: { name: "Perfect" } });
  });

  it("a typed real name isn't corrected into a different answer (class 6)", () => {
    const athletes: Puzzle = {
      ...puzzle,
      id: "athletes9",
      answers: [e(1, "Cristiano Ronaldo"), e(2, "Canelo Álvarez", ["Álvarez", "Canelo"]), e(3, "Michael Jordan", ["Jordan"]), ...puzzle.answers.slice(3)],
      extras: [v(29, "Jeffrey")],
    };
    const lex = lexOf({ people: ["alcaraz", "jeremy", "jordon"] });
    expect(judgeGuess("alcaraz", athletes, new Set(), lex)).toMatchObject({ kind: "unknown", known: true });
    expect(judgeGuess("jeremy", athletes, new Set(), lex)).toMatchObject({ kind: "unknown" });
    // One slip from an answer's own name is still a slip, even when the slip is someone's name too.
    expect(judgeGuess("jordon", athletes, new Set(), lex)).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Michael Jordan" } });
    // On a list of names, every name is its own: "Johnston" is not a slip of Johnson.
    const surnames: Puzzle = { ...puzzle, id: "surnames9", noun: "surnames", answers: [e(1, "Smith"), e(2, "Johnson"), ...puzzle.answers.slice(2)], extras: [] };
    expect(judgeGuess("johnston", surnames, new Set(), lexOf({ people: ["johnston"] })).kind).toBe("unknown");
    expect(judgeGuess("jonhson", surnames, new Set(), lexOf({ people: ["johnston"] }))).toMatchObject({ kind: "correct", entry: { name: "Johnson" } });
  });

  it("a misspelling isn't corrected into a place outside the region, or by a different first letter (class 6)", () => {
    const europe: Puzzle = { ...puzzle, id: "europe9", answers: [e(1, "Istanbul"), ...puzzle.answers.slice(1)], extras: [{ rank: 0, name: "Praia", aliases: [], elsewhere: true }] };
    expect(judgeGuess("praha", europe, new Set()).kind).toBe("unknown");
    expect(judgeGuess("praia", europe, new Set())).toMatchObject({ kind: "near", entry: { name: "Praia" } });
    const retail: Puzzle = { ...puzzle, id: "retail9", answers: [e(1, "Walmart", ["WMart"]), e(2, "Canada"), ...puzzle.answers.slice(2)], extras: [] };
    expect(judgeGuess("kmart", retail, new Set()).kind).toBe("unknown");
    // A first letter that sounds the same is still a slip.
    expect(judgeGuess("kanada", retail, new Set())).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Canada" } });
  });

  it("a category word is 'be more specific', never one answer (class 7)", () => {
    const food: Puzzle = {
      ...puzzle,
      id: "food9",
      noun: "fast food chains",
      answers: [e(1, "McDonald's"), e(4, "Luckin Coffee"), e(9, "Pizza Hut"), e(10, "Burger King"), ...puzzle.answers.slice(4)],
      extras: [v(13, "Hunt Brothers Pizza"), v(22, "Goat meat"), v(23, "Oil palm fruit"), v(44, "Coffee Beans Inc")],
    };
    for (const g of ["pizza", "coffee", "burgers", "burger", "meat", "fruit"]) expect(judgeGuess(g, food, new Set()), g).toMatchObject({ kind: "unknown", vague: expect.any(Number) });
    // A word no answer carries is a plain miss, and an answer named exactly that still counts.
    expect(judgeGuess("pizza", puzzle, new Set())).toEqual({ kind: "unknown", junk: false });
    const farm: Puzzle = { ...puzzle, id: "farm10", extras: [v(44, "Coffee"), v(2, "Pork")] };
    expect(judgeGuess("coffee", farm, new Set())).toMatchObject({ kind: "near", entry: { name: "Coffee" } });
    const leagues: Puzzle = {
      ...puzzle,
      id: "leagues9",
      noun: "sports leagues",
      answers: [e(1, "National Football League", ["NFL"]), ...puzzle.answers.slice(1)],
      extras: [v(14, "Australian Football League"), v(21, "Chinese Basketball Association")],
    };
    expect(judgeGuess("basketball", leagues, new Set())).toMatchObject({ kind: "unknown", vague: expect.any(Number) });
    expect(judgeGuess("football", leagues, new Set())).toMatchObject({ kind: "unknown", vague: expect.any(Number) });
  });

  it("short forms people type (class 8)", () => {
    const places: Puzzle = {
      ...puzzle,
      id: "places9",
      answers: [
        e(1, "Mount Everest"), e(2, "Mount Fuji"), e(3, "Los Angeles Rams"), e(4, "New York Jets"), e(5, "Law & Order"),
        e(6, "Kyle Field", ["Texas A&M"]), e(7, "St. Louis"), e(8, "Saint Paul"), e(9, "In-N-Out Burger"), e(10, "La Liga"),
      ],
      extras: [v(0, "The Fame / The Fame Monster"), v(0, "San Francisco 49ers", ["San Francisco Niners", "Niners"]), v(0, "Tampa Bay Rays", ["Rays"])],
    };
    const j = (g: string) => judgeGuess(g, places, new Set());
    expect(j("mt fuji")).toMatchObject({ kind: "correct", entry: { name: "Mount Fuji" } });
    expect(j("mt. everest")).toMatchObject({ kind: "correct", entry: { name: "Mount Everest" } });
    expect(j("la rams")).toMatchObject({ kind: "correct", entry: { name: "Los Angeles Rams" } });
    expect(j("ny jets")).toMatchObject({ kind: "correct", entry: { name: "New York Jets" } });
    expect(j("sf niners")).toMatchObject({ kind: "near", entry: { name: "San Francisco 49ers" } });
    expect(j("tb rays")).toMatchObject({ kind: "near", entry: { name: "Tampa Bay Rays" } });
    expect(j("la liga")).toMatchObject({ kind: "correct", entry: { name: "La Liga" } });
    expect(j("law n order")).toMatchObject({ kind: "correct", entry: { name: "Law & Order" } });
    expect(j("in and out burger")).toMatchObject({ kind: "correct", entry: { name: "In-N-Out Burger" } });
    expect(j("texas am")).toMatchObject({ kind: "correct", entry: { name: "Kyle Field" } });
    expect(j("saint louis")).toMatchObject({ kind: "correct", entry: { name: "St. Louis" } });
    expect(j("st paul")).toMatchObject({ kind: "correct", entry: { name: "Saint Paul" } });
    expect(j("the fame")).toMatchObject({ kind: "near", entry: { name: "The Fame / The Fame Monster" } });
    expect(j("the fame monster")).toMatchObject({ kind: "near", entry: { name: "The Fame / The Fame Monster" } });
    // A city shortened after the name too: "ncis la" is NCIS: Los Angeles, not NCIS.
    const tv: Puzzle = { ...puzzle, id: "tv9", answers: [e(5, "NCIS"), ...puzzle.answers.slice(1)], extras: [v(18, "NCIS: Los Angeles")] };
    expect(judgeGuess("ncis la", tv, new Set())).toMatchObject({ kind: "near", corrected: false, entry: { name: "NCIS: Los Angeles" } });
  });

  it("a franchise and a number is the franchise, on a list of franchises (class 8)", () => {
    const franchises: Puzzle = {
      ...puzzle,
      id: "franchises9",
      noun: "video game franchises",
      answers: [e(1, "Mario"), e(2, "Tetris"), e(7, "FIFA"), ...puzzle.answers.slice(3)],
      extras: [v(13, "The Sims")],
    };
    expect(judgeGuess("sims 4", franchises, new Set())).toMatchObject({ kind: "near", entry: { name: "The Sims" } });
    expect(judgeGuess("the sims 4", franchises, new Set())).toMatchObject({ kind: "near", entry: { name: "The Sims" } });
    expect(judgeGuess("fifa 23", franchises, new Set())).toMatchObject({ kind: "correct", entry: { name: "FIFA" } });
    // On a list of games, a number names a different game.
    const games: Puzzle = { ...franchises, id: "games9", noun: "video games" };
    expect(judgeGuess("fifa 23", games, new Set()).kind).toBe("unknown");
  });

  it("small bugs the audit reproduced (class 10)", () => {
    const games: Puzzle = {
      ...puzzle,
      id: "games10",
      answers: [e(1, "Minecraft"), e(6, "Mario Kart 8", ["Mario Kart", "Mariokart 8"]), ...puzzle.answers.slice(2)],
      extras: [v(20, "Call of Duty: Modern Warfare", ["Modern Warfare", "Modern Warfare 2019"])],
    };
    expect(judgeGuess("mario kart ds", games, new Set()).kind).toBe("unknown");
    expect(judgeGuess("modern warfare 2", games, new Set()).kind).toBe("unknown");
    expect(judgeGuess("modern warfare 2019", games, new Set())).toMatchObject({ kind: "near", entry: { rank: 20 } });
    const videos: Puzzle = {
      ...puzzle,
      id: "videos10",
      answers: [e(1, "Baby Shark Dance", ["Baby Shark"]), ...puzzle.answers.slice(1)],
      extras: [e(0, "Baby", ["Justin Bieber"])],
    };
    expect(judgeGuess("baby shark song", videos, new Set())).toMatchObject({ kind: "correct", entry: { name: "Baby Shark Dance" } });
    expect(judgeGuess("baby shark official video", videos, new Set())).toMatchObject({ kind: "correct", entry: { name: "Baby Shark Dance" } });
    const nba: Puzzle = { ...puzzle, id: "nba10", answers: [...puzzle.answers.slice(0, 9), v(10, "Isiah Thomas", ["Thomas"])], extras: [e(0, "Isaiah Thomas")] };
    expect(judgeGuess("isaiah thomas", nba, new Set())).toEqual({ kind: "typo", suggestions: ["Isaiah Thomas", "Isiah Thomas"] });
    expect(judgeGuess("isaiah thomas", nba, new Set([10]))).toMatchObject({ kind: "near", entry: { name: "Isaiah Thomas" } });
  });

  it("tens in words, a 'the' left out, and no slip on a word of an obscure name", () => {
    const books: Puzzle = {
      ...puzzle,
      id: "books11",
      extras: [v(108, "Fifty Shades of Grey"), v(140, "Republic of the Congo"), v(23, "The Phantom of the Opera"), e(0, "Better Homes and Gardens New Cook Book")],
    };
    expect(judgeGuess("50 shades of grey", books, new Set())).toMatchObject({ kind: "near", corrected: false, entry: { rank: 108 } });
    expect(judgeGuess("republic of congo", books, new Set())).toMatchObject({ kind: "near", corrected: false, entry: { rank: 140 } });
    expect(judgeGuess("phantom of opera", books, new Set())).toMatchObject({ kind: "near", corrected: false, entry: { rank: 23 } });
    expect(judgeGuess("holes", books, new Set()).kind).toBe("unknown");
    // A slip on a word of a name with a rank still lands: "kareen" (above).
  });

  it("a country's name offers its islands (owner, islands list)", () => {
    const isl = (rank: number, name: string, country: string | string[], aliases: string[] = []): Entry => ({ rank, name, aliases, value: "1 km²", country });
    const islands: Puzzle = {
      ...puzzle,
      id: "islands9",
      noun: "islands",
      answers: [
        isl(1, "Greenland", "Denmark"), isl(2, "New Guinea", ["Indonesia", "Papua New Guinea"]), isl(3, "Borneo", ["Indonesia", "Malaysia", "Brunei"]),
        isl(4, "Madagascar", "Madagascar"), isl(5, "Baffin Island", "Canada"), isl(6, "Sumatra", "Indonesia"), isl(7, "Honshu", "Japan"),
        isl(8, "Victoria Island", "Canada"), isl(9, "Great Britain", "United Kingdom", ["UK", "Britain"]), isl(10, "Ellesmere Island", "Canada"),
      ],
      extras: [
        isl(11, "Sulawesi", "Indonesia"), isl(13, "Java", "Indonesia"), isl(21, "Hokkaido", "Japan"), isl(36, "Kyushu", "Japan"), isl(50, "Shikoku", "Japan"),
        isl(292, "Okinawa Island", "Japan", ["Okinawa"]), isl(16, "Cuba", "Cuba"), isl(22, "Sri Lanka", "Sri Lanka"), isl(250, "Isle of Wight", "United Kingdom"),
        isl(300, "Kauai", "United States"),
      ],
    };
    const lex = lexOf({ countries: [["nippon", "japan"], ["usa", "united states"], ["america", "united states"], ["uk", "united kingdom"]] });
    const j = (g: string, found: number[] = []) => judgeGuess(g, islands, new Set(found), lex);
    expect(j("japan")).toEqual({ kind: "typo", suggestions: ["Hokkaido", "Honshu", "Kyushu", "Shikoku"] });
    expect(j("nippon")).toEqual({ kind: "typo", suggestions: ["Hokkaido", "Honshu", "Kyushu", "Shikoku"] });
    expect(j("japan", [7])).toEqual({ kind: "typo", suggestions: ["Hokkaido", "Kyushu", "Okinawa Island", "Shikoku"] });
    expect(j("indonesia")).toEqual({ kind: "typo", suggestions: ["Borneo", "New Guinea", "Sulawesi", "Sumatra"] });
    expect(j("malaysia")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Borneo" } });
    expect(j("america")).toMatchObject({ kind: "near", corrected: true, entry: { name: "Kauai" } });
    // An island named that, or one the list says the name means, is that island.
    expect(j("cuba")).toMatchObject({ kind: "near", corrected: false, entry: { name: "Cuba" } });
    expect(j("uk")).toMatchObject({ kind: "correct", corrected: false, entry: { name: "Great Britain" } });
    // A picked choice is that island.
    expect(judgeGuess("Honshu", islands, new Set(), lex, ["Hokkaido", "Honshu", "Kyushu", "Shikoku"])).toMatchObject({ kind: "correct", entry: { name: "Honshu" } });
  });
});

// The owner on MLB career hits (Nov 9): "robinson auto corrects into 3 options, none of them even jackie robinson
// which was my intention" (Brooks, Frank and Robinson Canó, whose first name it is), and "judge" put Joe Judge (#138)
// in the box, not Aaron Judge.
describe("a lone surname on a list of people", () => {
  const v = (rank: number, name: string, aliases: string[] = []): Entry => ({ rank, name, aliases, value: "1" });
  const hits: Puzzle = {
    ...puzzle,
    id: "hits12",
    noun: "MLB players",
    answers: [
      v(1, "Pete Rose"), v(2, "Ty Cobb", ["Cobb"]), v(3, "Hank Aaron", ["Aaron"]), v(4, "Stan Musial", ["Musial"]),
      v(5, "Tris Speaker", ["Speaker"]), v(6, "Derek Jeter", ["Jeter"]), v(7, "Cap Anson", ["Anson"]),
      v(8, "Honus Wagner", ["Wagner"]), v(9, "Carl Yastrzemski", ["Yaz"]), v(10, "Paul Molitor", ["Molitor"]),
    ],
    extras: [
      v(13, "Willie Mays", ["Mays"]), v(36, "Frank Robinson", ["Robinson"]), v(49, "Brooks Robinson", ["Robinson"]),
      v(80, "Robinson Canó", ["Robinson", "Canó"]), v(138, "Joe Judge"),
      e(0, "Jackie Robinson"), e(0, "Wilbert Robinson"), e(0, "Aaron Judge", ["Aaron"]), e(0, "Carl Mays"), e(0, "Billy Wagner"),
    ],
  };
  // The bank's people lexicon: every word of four letters or more of the names on its lists of people.
  const words = [...hits.answers, ...hits.extras].flatMap((x) => normalize(x.name).split(" ")).filter((w) => w.length >= 4);
  const lex = { alphabet: "", table: "", names: "", people: words.map((w) => fnv(w).toString(36)).join(" ") };
  const j = (g: string, p: Puzzle = hits, found: number[] = []) => judgeGuess(g, p, new Set(found), lex);

  it("offers everyone with that surname, the pool's too, before whose first name it is", () => {
    expect(j("robinson")).toEqual({ kind: "typo", suggestions: ["Brooks Robinson", "Frank Robinson", "Jackie Robinson", "Wilbert Robinson"] });
    // With room in the choice, the first name comes last: after the Robinsons, not instead of one.
    const fewer: Puzzle = { ...hits, id: "hits13", extras: hits.extras.filter((x) => x.name !== "Wilbert Robinson") };
    expect(j("robinson", fewer)).toEqual({ kind: "typo", suggestions: ["Brooks Robinson", "Frank Robinson", "Jackie Robinson", "Robinson Canó"] });
  });
  it("a surname match far down the ranking doesn't win alone over a namesake in the pool", () => {
    expect(j("judge")).toEqual({ kind: "typo", suggestions: ["Aaron Judge", "Joe Judge"] });
    // Ranked high, it is still the reading, put in the box to confirm.
    expect(j("mays")).toMatchObject({ kind: "near", corrected: true, entry: { name: "Willie Mays" } });
  });
  it("keeps the natural reading of a top-10 surname, then the next one once it's found", () => {
    expect(j("aaron")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Hank Aaron" } });
    // A top-10 answer's own alias counts at once, as before, though namesakes in the pool carry the word.
    expect(j("wagner")).toMatchObject({ kind: "correct", corrected: false, entry: { name: "Honus Wagner" } });
    expect(j("aaron", hits, [3])).toMatchObject({ kind: "near", corrected: true, entry: { name: "Aaron Judge" } });
  });
  it("only on a list of people: without the people lexicon the readings stay as they were", () => {
    expect(judgeGuess("judge", hits, new Set())).toMatchObject({ kind: "near", corrected: true, entry: { name: "Joe Judge" } });
    expect(judgeGuess("robinson", hits, new Set())).toEqual({ kind: "typo", suggestions: ["Brooks Robinson", "Frank Robinson", "Robinson Canó"] });
  });
});

// Launch week (Nov 12): the guess box says typos are free, yet "hustin bieber" and "lana del ray" found nothing (a
// first letter slipped, a three-letter word slipped). Whole words shared with one answer alone are evidence.
describe("one slip beside words only one answer has", () => {
  const artists: Puzzle = {
    ...puzzle,
    id: "artists14",
    noun: "artists",
    answers: [e(1, "Taylor Swift"), e(2, "The Weeknd"), e(3, "Bad Bunny"), e(4, "Justin Bieber", ["Bieber"]), ...puzzle.answers.slice(4)],
    extras: [e(22, "Lana Del Rey"), e(38, "Justin Timberlake", ["Timberlake"]), e(0, "Mount Elbert"), e(0, "Mount Kosciuszko")],
  };
  const j = (g: string, p: Puzzle = artists) => judgeGuess(g, p, new Set());
  it("takes the slip, the first letter or a short word included", () => {
    expect(j("hustin bieber")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Justin Bieber" } });
    expect(j("lana del ray")).toMatchObject({ kind: "near", corrected: true, entry: { name: "Lana Del Rey" } });
    expect(j("bed bunny")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Bad Bunny" } });
    // A swap of two letters is one slip too.
    expect(j("lana del rye")).toMatchObject({ kind: "near", corrected: true, entry: { name: "Lana Del Rey" } });
  });
  it("not when another entry has the shared words too", () => {
    const two: Puzzle = { ...artists, id: "artists15", extras: [...artists.extras, e(0, "Jaxon Bieber"), e(0, "Bugs Bunny")] };
    expect(j("hustin bieber", two).kind).toBe("unknown");
    expect(j("bed bunny", two).kind).toBe("unknown");
    // "justin" is two answers' word: "justin biever" is still a slip of the word left, as before.
    expect(j("justin biever", two)).toMatchObject({ kind: "correct", entry: { name: "Justin Bieber" } });
  });
  it("not beside a short or generic shared word, or a word left that names another entry", () => {
    const cars: Puzzle = { ...puzzle, id: "cars14", answers: [e(1, "Volkswagen Beetle", ["VW Bug", "Beetle"]), ...puzzle.answers.slice(1)], extras: [] };
    expect(j("vw bus", cars).kind).toBe("unknown");
    expect(j("mount whitney").kind).toBe("unknown");
    // "mount" is a generic word, even where one entry alone has it.
    const one: Puzzle = { ...artists, id: "artists16", extras: artists.extras.filter((x) => x.name !== "Mount Kosciuszko") };
    expect(j("mount albert", one).kind).toBe("unknown");
    // "dustin" is a word of another entry here: "dustin bieber" may be someone else. Without him, it is a slip.
    const dustin: Puzzle = { ...artists, id: "artists17", extras: [...artists.extras, e(0, "Dustin Lynch")] };
    expect(j("dustin bieber", dustin).kind).toBe("unknown");
    expect(j("dustin bieber")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Justin Bieber" } });
  });
  // The leak audit (Nov 13): real names outside the bank, judged with no known names, that the rule first took in.
  it("not a short word slipped into other sounds: another name, not a slip", () => {
    const leaks: Puzzle = {
      ...puzzle,
      id: "leaks14",
      extras: [e(12, "San Marino"), e(13, "Green Day"), e(14, "Astro Boy"), e(15, "Princess Tower"), e(16, "San Francisco")],
    };
    for (const g of ["dan marino", "green bay", "astro bot", "princess power", "sao francisco"]) expect(j(g, leaks).kind, g).toBe("unknown");
  });
  it("leaves different answers sharing words different (South and North Korea)", () => {
    const koreas: Puzzle = { ...puzzle, id: "koreas14", extras: [e(12, "South Korea"), e(13, "North Korea")] };
    expect(j("south korea", koreas)).toMatchObject({ kind: "near", corrected: false, entry: { name: "South Korea" } });
    expect(j("north korea", koreas)).toMatchObject({ kind: "near", corrected: false, entry: { name: "North Korea" } });
    expect(j("sorth korea", koreas)).toMatchObject({ kind: "near", corrected: true, entry: { name: "South Korea" } });
    const south: Puzzle = { ...puzzle, id: "koreas15", extras: [e(12, "South Korea")] };
    expect(j("north korea", south).kind).toBe("unknown");
  });
});
