import { describe, expect, it } from "vitest";
import { checkBank, checkCandidates, checkQuestion, KINDS, loadBank, MIN_QUESTIONS, sameSubject, subjectWords, type Question } from "./check";

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
    flat.questions[0].answer = 3;
    flat.questions[1].answer = 4;
    flat.questions[1].unit = "metres";
    expect(checkBank(flat)).toEqual([
      "no answer under 1: the bank needs a spread of magnitudes",
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
