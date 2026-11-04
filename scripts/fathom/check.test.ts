import { describe, expect, it } from "vitest";
import { checkBank, checkQuestion, KINDS, loadBank, type Question } from "./check";

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

/** A bank that passes: 50 questions over every kind, 12 easy, answers from under 1 to billions. */
function bank(): { version: 1; questions: Question[] } {
  const questions = Array.from({ length: 50 }, (_, i) =>
    question({
      id: `question-${i + 1}`,
      kind: KINDS[i % KINDS.length],
      question: `How tall is landmark number ${String.fromCharCode(97 + (i % 26))}${i}?`,
      answer: i === 0 ? 0.5 : i === 1 ? 2e9 : 20 + i,
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

  it("wants 50 questions, 8 kinds, no kind over 9, 12 easy openers and a spread of magnitudes", () => {
    const short = bank();
    short.questions.pop();
    expect(checkBank(short)).toEqual(["49 questions; the bank needs at least 50"]);

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
    expect(checkBank(flat)).toEqual([
      "no answer under 1: the bank needs a spread of magnitudes",
      "no answer in the billions: the bank needs a spread of magnitudes",
    ]);
  });

  it("wants version 1 and a questions array", () => {
    expect(checkBank({ version: 2, questions: [] })[0]).toBe("version must be 1, not 2");
    expect(checkBank({ version: 1 })).toEqual(["questions must be an array"]);
  });
});
