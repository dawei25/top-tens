import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readList, type NameList } from "../../src/game/fathom-name";
import {
  bankWarnings,
  checkBank,
  checkCandidates,
  checkQuestion,
  fileLists,
  KINDS,
  listMisses,
  loadBank,
  MIN_QUESTIONS,
  MIN_YEARS_AGO,
  sameSubject,
  subjectWords,
  type ListSource,
  type Question,
} from "./check";

const question = (over: Partial<Question> & Record<string, unknown> = {}): Question =>
  ({
    id: "eiffel-tower-height",
    kind: "landmarks",
    question: "How tall is the Eiffel Tower?",
    unit: "metres",
    answer: 330,
    definition: "to the tip",
    fact: "It was the tallest structure in the world for 41 years.",
    source: { title: "Eiffel Tower", url: "https://en.wikipedia.org/wiki/Eiffel_Tower" },
    typical: 2,
    easy: true,
    ...over,
  }) as Question;

const errors = (over: Partial<Question> & Record<string, unknown>) => checkQuestion(question(over), 0);

/** A bank that passes: 50 questions over every kind, 12 easy, answers from under 1 to billions (2 billion metres). */
function bank(): { version: 1; questions: Question[] } {
  const questions = Array.from({ length: 50 }, (_, i) =>
    question({
      id: `question-${i + 1}`,
      kind: KINDS[i % KINDS.length],
      question: `How tall is landmark number ${String.fromCharCode(97 + (i % 26))}${i}?`,
      answer: i === 0 ? 0.5 : i === 1 ? 2 : 20 + i,
      ...(i === 1 && { unit: "billion metres" }),
      definition: undefined,
      easy: i < 12,
    }),
  );
  for (const q of questions) delete q.definition;
  return { version: 1, questions };
}

describe("Fathom question bank", () => {
  it("the real bank passes every check", () => {
    expect(checkBank(loadBank())).toEqual([]);
  });

  it("a well-formed question passes", () => {
    expect(errors({})).toEqual([]);
    expect(checkBank(bank())).toEqual([]);
  });
});

describe("checkQuestion", () => {
  it("wants kebab-case ids, a known kind and an allowed typical miss", () => {
    expect(errors({ id: "Eiffel_Tower" })).toEqual(["Eiffel_Tower: id must be kebab-case"]);
    expect(errors({ kind: "buildings" as Question["kind"] })[0]).toMatch(/kind "buildings" is not one of/);
    expect(errors({ typical: 4 as Question["typical"] })[0]).toMatch(/typical 4 is not one of/);
    expect(errors({ easy: "yes" as unknown as boolean })).toEqual(["eiffel-tower-height: easy must be true or false"]);
    expect(errors({ colour: "red" })).toEqual(['eiffel-tower-height: unknown field "colour"']);
  });

  it("wants a positive, finite answer", () => {
    for (const answer of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, "330"])
      expect(errors({ answer: answer as number })).toEqual(["eiffel-tower-height: answer must be a positive finite number"]);
  });

  it("wants one plain question that ends with a question mark and doesn't give the answer away", () => {
    expect(errors({ question: "How tall is the Eiffel Tower" })).toEqual(["eiffel-tower-height: question must end with ?"]);
    expect(errors({ question: "Paris? How tall is the Eiffel Tower?" })).toEqual([
      "eiffel-tower-height: question must ask one thing (one ?)",
    ]);
    expect(errors({ question: "Is the Eiffel Tower 330 tall?" })).toEqual(["eiffel-tower-height: question gives away the answer"]);
    expect(errors({ definition: "330 to the tip" })).toEqual(["eiffel-tower-height: definition gives away the answer"]);
    expect(errors({ question: "How tall is the Eiffel Tower—really?" })).toEqual([
      "eiffel-tower-height: question has an em dash (UI copy uses none)",
    ]);
  });

  it("keeps the unit out of the question, except a count's own noun after How many", () => {
    expect(errors({ question: "How tall is the Eiffel Tower in metres?" })).toEqual([
      'eiffel-tower-height: question repeats the unit "metres" (the game shows it beside the input)',
    ]);
    expect(errors({ question: "How many metres tall is the Eiffel Tower?" })[0]).toMatch(/repeats the unit "metres"/);
    expect(errors({ question: "How many steps lead to the top of the Eiffel Tower?", unit: "steps" })).toEqual([]);
    expect(errors({ question: "How many lifts carry people up the Eiffel Tower?", unit: "people" })[0]).toMatch(
      /repeats the unit "people"/,
    );
    expect(errors({ unit: "Metres" })).toEqual(['eiffel-tower-height: unit "Metres" must be lower case']);
    expect(errors({ unit: "degrees Celsius" })).toEqual([]);
  });

  // Nov 5 (owner): the THOUSAND / MILLION / BILLION keys went; the player just types the number, so every answer is
  // short in its unit: at most 6 digits before the decimal point, a scale word in the unit for big counts.
  it("wants at most 6 digits before the decimal point, in a unit with a scale word when it's big", () => {
    expect(errors({ answer: 999_999.5 })).toEqual([]);
    expect(errors({ answer: 1_000_000 })[0]).toMatch(/answer 1000000 has more than 6 digits before the decimal point/);
    expect(errors({ question: "How many trees are there on Earth?", unit: "trees", answer: 3.04e12 })[0]).toMatch(/more than 6 digits/);
    expect(errors({ question: "How many trees are there on Earth?", unit: "billion trees", answer: 3040 })).toEqual([]);
    expect(errors({ question: "What is the population of New York City?", unit: "million people", answer: 8.80419 })).toEqual([]);
    expect(errors({ question: "How much water does an Olympic pool hold?", unit: "million litres", answer: 2.5 })).toEqual([]);
    // The unit after the scale word follows the same rules: kept out of the question, except a count's after How many.
    expect(errors({ question: "How many people live in New York City?", unit: "million people", answer: 8.8 })).toEqual([]);
    expect(errors({ question: "How tall is the Eiffel Tower in metres?", unit: "million metres", answer: 3 })[0]).toMatch(/repeats the unit "metres"/);
    // No scale word for an answer under 1 of it.
    expect(errors({ unit: "million people", answer: 0.012, question: "How big is the crowd?" })[0]).toMatch(/under 1 million people/);
  });

  it("wants a short definition phrase and a one-sentence fact", () => {
    expect(errors({ definition: "To the tip." })[0]).toMatch(/definition is a phrase/);
    expect(errors({ definition: "x".repeat(61) })[0]).toMatch(/definition is longer than/);
    expect(errors({ fact: "It is tall. It is in Paris." })).toEqual(["eiffel-tower-height: fact must be one sentence"]);
    expect(errors({ fact: "It is tall" })).toEqual(["eiffel-tower-height: fact must end with a full stop"]);
  });

  it("wants an https source with a title", () => {
    expect(errors({ source: { title: "Eiffel Tower", url: "http://en.wikipedia.org/wiki/Eiffel_Tower" } })).toEqual([
      "eiffel-tower-height: source.url must be https",
    ]);
    expect(errors({ source: { title: "", url: "https://en.wikipedia.org/wiki/Eiffel_Tower" } })).toEqual([
      "eiffel-tower-height: source.title is missing",
    ]);
    expect(errors({ source: { title: "Eiffel Tower", url: "wikipedia" } })).toEqual([
      'eiffel-tower-height: source.url "wikipedia" is not a URL',
    ]);
  });
});

describe("checkBank", () => {
  it("rejects duplicate ids and repeated questions", () => {
    const b = bank();
    b.questions[1] = { ...b.questions[1], id: b.questions[0].id };
    b.questions[3] = { ...b.questions[3], question: b.questions[2].question };
    expect(checkBank(b)).toEqual(["question-1: duplicate id", "question-4: same question as question-3"]);
  });

  it("rejects a fact that gives away another question's answer", () => {
    const b = bank();
    b.questions[5].answer = 1306;
    b.questions[6].fact = "Its record is 1,306 of them.";
    expect(checkBank(b)).toEqual(["question-7: fact gives away the answer to question-6 (1306)"]);
  });

  // A judge's find: the number after the digits was matched by [^\d], so "300.12" and "400,000" counted as 300 and 400.
  it("counts a number only when it stands alone, not inside a longer one", () => {
    const b = bank();
    b.questions[5].answer = 300;
    b.questions[7].answer = 400;
    b.questions[6].fact = "It weighs 300.12 tonnes and holds 400,000 people.";
    expect(checkBank(b)).toEqual([]);
    for (const fact of ["It is 300.", "It is 300, give or take.", "It is 300 tonnes.", "Some 300 of them."]) {
      b.questions[6].fact = fact;
      expect(checkBank(b), fact).toEqual(["question-7: fact gives away the answer to question-6 (300)"]);
    }
    // In a question or a definition too.
    expect(errors({ answer: 330, definition: "330.5 to the tip" })).toEqual([]);
    expect(errors({ answer: 330, question: "How tall is the 3,330 tower?" })).toEqual([]);
    expect(errors({ answer: 330, definition: "330, to the tip" })).toEqual(["eiffel-tower-height: definition gives away the answer"]);
  });

  it("wants enough questions, 8 kinds, no kind over 9, 12 easy openers and a spread of magnitudes", () => {
    const short = bank();
    short.questions.length = MIN_QUESTIONS - 1;
    expect(checkBank(short)).toEqual([`${MIN_QUESTIONS - 1} questions; the bank needs at least ${MIN_QUESTIONS}`]);

    const narrow = bank();
    narrow.questions.forEach((q, i) => (q.kind = KINDS[i % 7]));
    expect(checkBank(narrow)).toEqual(["7 kinds; the bank needs at least 8"]);

    const lopsided = bank();
    lopsided.questions.slice(0, 10).forEach((q) => (q.kind = "space"));
    expect(checkBank(lopsided)).toContain("13 questions of kind space; at most 9");

    const hard = bank();
    hard.questions[0].easy = false;
    expect(checkBank(hard)).toEqual(["11 easy openers; the bank needs at least 12"]);

    const flat = bank();
    flat.questions[0].answer = 30;
    flat.questions[1].answer = 40;
    flat.questions[1].unit = "metres";
    expect(checkBank(flat)).toEqual([
      "no answer under 10: the bank needs a spread of magnitudes",
      "no answer in the billions: the bank needs a spread of magnitudes",
    ]);
    // The billions are counted with the unit's scale word: 2 billion metres is, 2 metres isn't.
    const small = bank();
    small.questions[1].unit = "metres";
    expect(checkBank(small)).toEqual(["no answer in the billions: the bank needs a spread of magnitudes"]);
  });

  it("wants version 1 and a questions array", () => {
    expect(checkBank({ version: 2, questions: [] })[0]).toBe("version must be 1, not 2");
    expect(checkBank({ version: 1 })).toEqual(["questions must be an array"]);
  });
});

describe("candidates for the bank", () => {
  const src = (title: string) => ({ title, url: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}` });
  const q = (text: string, title: string) => ({ question: text, source: src(title) });
  const giraffe = question({ id: "giraffe-tongue", question: "How long is a giraffe's tongue?", source: src("Giraffe") });

  it("reads a question's subject without its measure words", () => {
    expect([...subjectWords("How tall is the Eiffel Tower?")]).toEqual(["eiffel", "tower"]);
    expect([...subjectWords("How long is a giraffe's tongue?")]).toEqual(["giraffe", "tongue"]);
    expect([...subjectWords("How many islands belong to Hong Kong?")]).toEqual(["island", "belong", "hong", "kong"]);
  });

  it("calls two questions one subject when they share a source page or most of their words", () => {
    expect(sameSubject(q("How tall is a giraffe?", "Giraffe"), giraffe)).toBe(true);
    expect(sameSubject(q("How much does the Eiffel Tower weigh?", "Iron"), question())).toBe(true);
    expect(sameSubject(q("How tall is the Burj Khalifa?", "Burj Khalifa"), question())).toBe(false);
    const escalator = q("How long is Hong Kong's Central–Mid-Levels escalator?", "Escalator");
    expect(sameSubject(escalator, q("How many islands belong to Hong Kong?", "Islands"))).toBe(false);
  });

  it("checks candidates as they would join the bank", () => {
    const real = bank();
    const ball = question({
      id: "bowling-ball",
      kind: "sports",
      question: "How much does the heaviest bowling ball weigh?",
      unit: "kilograms",
      answer: 7.26,
      source: src("Ten-pin bowling"),
    });
    delete ball.definition;
    const candidates = (...questions: Question[]) => checkCandidates({ version: 1, questions }, real);
    expect(candidates(ball)).toEqual([]);

    const tall = { ...ball, kind: "animals", id: "giraffe-height", question: "How tall is a giraffe?", source: src("Giraffe") };
    expect(checkCandidates({ version: 1, questions: [tall] }, { version: 1, questions: [...real.questions, giraffe] })).toEqual([
      `giraffe-height: same subject as giraffe-tongue in the bank ("How long is a giraffe's tongue?")`,
    ]);
    expect(candidates(ball, { ...ball, id: "bowling-ball-2", question: "What does the heaviest bowling ball weigh?" })).toEqual([
      `bowling-ball-2: same subject as candidate bowling-ball ("How much does the heaviest bowling ball weigh?")`,
    ]);
    expect(candidates({ ...ball, id: "question-1" })).toContain("question-1: duplicate id");
    // Too many digits: the bank's own per-question rule reports it (one message is enough).
    expect(candidates({ ...ball, unit: "people", answer: 8804190 }).some((e) => e.startsWith("bowling-ball: answer 8804190 has more than 6 digits"))).toBe(true);
  });
});

// The owner's revamp: a percent round and a year round beside the estimate.
describe("rounds", () => {
  /** A question of another round, as the bank holds it: no typical miss (a ratio means nothing there). */
  const of = (over: Record<string, unknown>) => {
    const q = question({ definition: undefined, ...over }) as unknown as Record<string, unknown>;
    delete q.definition;
    delete q.typical;
    return q as unknown as Question;
  };
  const percent = (over: Record<string, unknown> = {}) =>
    of({ id: "ocean-share", kind: "nature", round: "percent", question: "How much of Earth's surface is ocean?", unit: "percent", answer: 71, ...over });
  const year = (over: Record<string, unknown> = {}) =>
    of({ id: "iphone-year", kind: "everyday", round: "year", question: "In what year did the first iPhone go on sale?", unit: "year", answer: 2007, ...over });
  const errs = (q: Question) => checkQuestion(q, 0);
  const thisYear = new Date().getFullYear();

  it("takes a percent, a year and a name-it question, and no other round", () => {
    expect(errs(percent())).toEqual([]);
    expect(errs(year())).toEqual([]);
    expect(errs(year({ question: "When did the first iPhone go on sale?" }))).toEqual([]);
    expect(errs(question({ round: "estimate" }))).toEqual([]);
    expect(errs(question({ round: "guess" as Question["round"] }))[0]).toMatch(/round "guess" is not one of estimate, percent, year, name/);
  });

  it("keeps a round's unit to its round", () => {
    expect(errs(percent({ unit: "%" }))).toEqual(['ocean-share: a percent question\'s unit is "percent", not "%"']);
    expect(errs(year({ unit: "years" }))).toEqual(['iphone-year: a year question\'s unit is "year", not "years"']);
    // An estimate in percent or a calendar year would be scored on the wrong scale.
    expect(errs(question({ unit: "percent", question: "How much of Earth is ocean?", answer: 71 }))).toEqual([
      'eiffel-tower-height: unit "percent" belongs to a percent question: give it round "percent"',
    ]);
    expect(errs(question({ unit: "year", question: "When was it built?", answer: 1889 }))).toEqual([
      'eiffel-tower-height: unit "year" belongs to a year question: give it round "year"',
    ]);
    // A duration in years is an estimate.
    expect(errs(question({ unit: "years", question: "How old was the oldest Greenland shark?", answer: 392 }))).toEqual([]);
  });

  it("wants a percent from 0 to 100, kept out of the question", () => {
    expect(errs(percent({ answer: 100 }))).toEqual([]);
    expect(errs(percent({ answer: 0.5 }))).toEqual([]);
    expect(errs(percent({ answer: 101 }))).toEqual(["ocean-share: a percent's answer is 0 to 100, not 101"]);
    expect(errs(percent({ question: "What percent of Earth's surface is ocean?" }))[0]).toMatch(/repeats the unit "percent"/);
    expect(errs(percent({ question: "What percentage of Earth's surface is ocean?" }))).toEqual([]);
  });

  // A year scores by how many times off how long ago it was, steep for something recent: at least 10 years ago.
  it(`wants a whole year of four digits, at least ${MIN_YEARS_AGO} years ago (${thisYear - MIN_YEARS_AGO} at the latest)`, () => {
    expect(MIN_YEARS_AGO).toBe(10);
    const latest = thisYear - MIN_YEARS_AGO;
    expect(errs(year({ answer: latest }))).toEqual([]);
    expect(errs(year({ answer: 1066 }))).toEqual([]);
    expect(errs(year({ answer: 2007.5 }))).toEqual([
      `iphone-year: a year's answer is a whole year of four digits, at least 10 years ago (1000 to ${latest}), not 2007.5`,
    ]);
    expect(errs(year({ answer: 800 }))[0]).toMatch(/whole year of four digits/);
    expect(errs(year({ answer: latest + 1 }))[0]).toMatch(/at least 10 years ago/);
    expect(errs(year({ answer: thisYear }))[0]).toMatch(/at least 10 years ago/);
    expect(errs(year({ answer: thisYear + 1 }))[0]).toMatch(/whole year of four digits/);
  });

  it("wants a year question to ask for a year", () => {
    expect(errs(year({ question: "How long ago did the first iPhone go on sale?" }))).toEqual([
      'iphone-year: a year question asks "In what year...?" or "When...?"',
    ]);
  });

  it("wants a typical miss, when there is one, on an estimate only (it's a ratio)", () => {
    expect(errs({ ...percent(), typical: 2 } as Question)).toEqual(['ocean-share: typical is an estimate\'s (a ratio): leave it out of a percent question']);
    expect(errs(question({ typical: 4 as Question["typical"] }))[0]).toMatch(/typical 4 is not one of/);
  });

  // The rebuilt bank: kept old questions (with a typical miss) and judged candidates that carry a round, verified: true
  // and no typical miss. Both shapes pass.
  it("takes a judged candidate's shape: a round, verified, no typical miss", () => {
    const judged = (over: Record<string, unknown>) => {
      const q = question({ round: "estimate", verified: true, ...over }) as unknown as Record<string, unknown>;
      delete q.typical;
      return q as unknown as Question;
    };
    expect(errs(judged({}))).toEqual([]);
    expect(errs({ ...percent(), verified: true } as Question)).toEqual([]);
    expect(errs({ ...year(), verified: true } as Question)).toEqual([]);
    expect(errs(judged({ verified: "yes" }))).toEqual(["eiffel-tower-height: verified, when present, is true or false"]);
    const b = bank();
    b.questions = b.questions.map((q, i) => (i % 2 ? judged({ ...q }) : q));
    expect(checkBank(b)).toEqual([]);
  });

  it("counts the spread of magnitudes on estimates only", () => {
    const b = bank();
    // The only answer under 1 was question-1's 0.5 metres: a 0.5% share doesn't stand in for it.
    b.questions[0] = percent({ id: "question-1", answer: 0.5, question: "How much of Earth's water is fresh and liquid?" });
    expect(checkBank(b)).toEqual(["no answer under 10: the bank needs a spread of magnitudes"]);
  });

  // In one game, a year that another question's text states gives the year question away.
  it("rejects a year another question's question, definition or fact states", () => {
    const b = bank();
    b.questions.push(year({ id: "iphone-year", kind: "everyday" }));
    expect(checkBank(b)).toEqual([]);
    b.questions[3].definition = "2007 survey";
    b.questions[4].fact = "It was built in 2007.";
    b.questions[5].question = "How tall was the tower in 2007?";
    expect(checkBank(b)).toEqual([
      "question-4: definition gives away the answer to iphone-year (2007)",
      "question-5: fact gives away the answer to iphone-year (2007)",
      "question-6: question gives away the answer to iphone-year (2007)",
    ]);
  });

  // The owner: "Too many are how much does xx weigh, how tall is xx." No more than one in five of the bank: a warning
  // for now (the old bank fails it until the new one lands), not an error.
  it("warns when more than one in five of the bank is a how tall / how heavy question", () => {
    const b = bank();
    expect(checkBank(b)).toEqual([]);
    expect(bankWarnings(b)).toEqual(["50 of 50 questions (100%) are how tall / how heavy; at most 1 in 5 (10)"]);
    b.questions.forEach((q, i) => {
      if (i >= 10) q.question = `How many visitors does landmark number ${i} get?`;
    });
    expect(bankWarnings(b)).toEqual([]);
    b.questions[10].question = "How much does landmark number 10 weigh?";
    expect(bankWarnings(b)).toEqual(["11 of 50 questions (22%) are how tall / how heavy; at most 1 in 5 (10)"]);
  });
});

// The owner: "Name a country that has 6 land borders" ... "brain didn't even register". A name-it question asks for a
// name and is checked against its list: the noun named, the target fair (at least 3 good answers), and every name on
// the list registering. The lists here are the browser suite's fixtures (a subset of the real ones).
describe("name-it questions", () => {
  const FIXTURES = join(import.meta.dirname, "..", "..", "e2e", "fixtures", "fathom", "lists");
  const fixtures: ListSource = fileLists(FIXTURES);
  const none: ListSource = () => undefined;
  const name = (over: Record<string, unknown> = {}) =>
    ({
      id: "name-country-50m-people",
      kind: "places",
      round: "name",
      list: "countries-population",
      target: 50_000_000,
      question: "Name a country with about 50 million people",
      easy: false,
      ...over,
    }) as unknown as Question;
  const errs = (q: Question, lists = fixtures) => checkQuestion(q, 0, lists);

  it("passes a fair one", () => {
    expect(errs(name())).toEqual([]);
    expect(errs(name({ id: "b", list: "land-borders", target: 6, question: "Name a country with 6 land borders" }))).toEqual([]);
    expect(errs(name({ id: "c", list: "countries-area", target: 244376, question: "Name a country about as big as the UK", except: ["United Kingdom"] }))).toEqual([]);
    expect(errs(name({ list: "cities-population", target: 1e7, question: "Name a city with about 10 million people", definition: "its whole urban area" }))).toEqual([]);
    // The cities list starts at 5 million: a city of about 1 million has no fair answer on it.
    expect(errs(name({ list: "cities-population", target: 1e6, question: "Name a city with about 1 million people" }))[0]).toMatch(/leaves 0 answer\(s\) scoring 70/);
    expect(errs(name({ fact: "Colombia and South Korea are within 3% of it." }))).toEqual([]);
  });

  it("asks for a name and names what to name, with no unit, answer or source of its own", () => {
    expect(errs(name({ question: "Which country has about 50 million people?" }))).toEqual([
      'name-country-50m-people: a name-it question asks "Name a ..." or "Name an ..."',
      "name-country-50m-people: a name-it question is an ask, with no end punctuation",
    ]);
    expect(errs(name({ question: "Name a place with about 50 million people" }))).toEqual([
      'name-country-50m-people: question doesn\'t name what to name ("country")',
    ]);
    expect(errs(name({ unit: "people", answer: 5e7 }))).toEqual([
      'name-country-50m-people: a name-it question takes its unit from its list: leave "unit" out',
      'name-country-50m-people: a name-it question takes its answer from its list: leave "answer" out',
    ]);
    expect(errs(name({ colour: "red" }))).toEqual(['name-country-50m-people: unknown field "colour"']);
    expect(errs(name({ question: "Name a country with about 50 million people — roughly" }))).toContain("name-country-50m-people: question has an em dash (UI copy uses none)");
  });

  it("wants a target that leaves at least 3 good answers, in the list's own terms", () => {
    // 14 land borders: China and Russia, and nothing within a step.
    expect(errs(name({ list: "land-borders", target: 14, question: "Name a country with 14 land borders" }))).toEqual([
      "name-country-50m-people: target 14 leaves 2 answer(s) scoring 70 or more on land-borders; it needs at least 3",
    ]);
    expect(errs(name({ list: "land-borders", target: 6.5, question: "Name a country with 6.5 land borders" }))[0]).toMatch(/must be a whole number/);
    expect(errs(name({ target: 0 }))).toContain("name-country-50m-people: list countries-population scores a ratio: target must be more than 0");
    expect(errs(name({ target: -3 }))).toEqual(["name-country-50m-people: target must be a finite number, 0 or more"]);
    expect(errs(name({ except: ["Atlantis"] }))).toEqual(['name-country-50m-people: except "Atlantis" isn\'t a name on list countries-population']);
  });

  it("waits for its list only while a judge hasn't verified it", () => {
    expect(errs(name({ verified: false, note: "check 3 answers near 50 million" }), none)).toEqual([]);
    expect(errs(name(), none)).toEqual(['name-country-50m-people: list "countries-population" isn\'t there (public/fathom/lists/countries-population.json)']);
    expect(errs(name({ verified: true }), none)[0]).toMatch(/isn't there/);
    expect(errs(name({ note: "" }), none)).toContain("name-country-50m-people: note, when present, says what the judge must check");
    expect(errs(name({ list: "../secrets" }))).toEqual(["name-country-50m-people: list must be a list id (kebab-case)"]);
    // The bank says what waits.
    const b = { version: 1, questions: [name({ verified: false }), name({ id: "x", verified: false, target: 1e8 })] };
    expect(bankWarnings(b, none)).toEqual([
      "2 name-it question(s) wait for list countries-population (public/fathom/lists/countries-population.json); the game leaves them out until it's there",
    ]);
    expect(bankWarnings(b, fixtures)).toEqual([]);
  });

  it("finds what on a list doesn't register: a name or alias, or one of the names everyone uses", () => {
    for (const id of ["countries-population", "countries-area", "land-borders", "cities-population"]) expect(listMisses(fixtures(id)!), id).toEqual([]);
    const list = (entries: NameList["entries"]): NameList => ({ ...fixtures("countries-population")!, entries });
    // "Holland" missing from the Netherlands, and "UK" taken by two countries' worth of aliases elsewhere.
    expect(listMisses(list([{ name: "Netherlands", aliases: [], value: 1 }, { name: "Spain", aliases: [], value: 2 }]))).toEqual([
      'list countries-population: "Holland" doesn\'t register as Netherlands',
    ]);
    // An alias five entries share: the matcher offers the four biggest, so the fifth never registers by it.
    const andes = (name: string, value: number) => ({ name, aliases: ["Andes"], value });
    expect(listMisses(list([andes("Colombia", 5), andes("Peru", 4), andes("Chile", 3), andes("Ecuador", 2), andes("Bolivia", 1)]))).toEqual([
      'list countries-population: "Andes" doesn\'t register as Bolivia',
    ]);
  });

  // When the real lists are there (once the data agent's branch is merged), the real bank is checked against them.
  it("the real bank passes with whatever lists are in public/fathom/lists", () => {
    expect(checkBank(loadBank(), fileLists())).toEqual([]);
  });
  // A dry run of the lists landing: the real bank's name-it questions against the fixtures (a subset of each list, so a
  // target fair here is very likely fair on the whole list; the judge still checks the real one).
  it("the real bank's name-it questions pass against the fixture lists", () => {
    const bank = loadBank() as { questions: Record<string, unknown>[] };
    expect(bank.questions.filter((q) => q.round === "name").length).toBeGreaterThanOrEqual(10);
    expect(checkBank(bank, fixtures)).toEqual([]);
    expect(bankWarnings(bank, fixtures)).toEqual([]);
    expect(readList(JSON.parse(readFileSync(join(FIXTURES, "land-borders.json"), "utf8")))?.scoring).toBe("steps");
  });
});

describe("question length", () => {
  it("keeps question and definition short enough for LOCK IN to stay above a phone keyboard", () => {
    const long = question({ question: `How far does the world's longest non-stop passenger flight go?`, definition: "Singapore Airlines, New York to Singapore, 2026" });
    expect(checkQuestion(long, 0).some((e) => e.includes("characters"))).toBe(true);
    const short = question({ question: "How far does the world's longest non-stop flight go?", definition: "New York to Singapore, 2026" });
    expect(checkQuestion(short, 0).some((e) => e.includes("characters"))).toBe(false);
  });
});
